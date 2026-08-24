import {
  legacyThreadProjectionPatch,
  threadProjectionNeedsAuthoritativeRepair,
  threadProjectionPatchFromEvent,
  type SyncEvent,
  type ThreadProjectionPatchV1,
} from "@codewide/sync-client";
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { isStableThreadCursorTurn } from "./thread-cursor-sync";

export type TerminalProjectionProof = {
  threadId: string;
  turnId: string;
  /** A positive content witness. Sparse App Server notifications cannot prove
   * that an authoritative turn has no agent message. */
  agentMessage: { utf8Bytes: number; sha256: string };
};

/**
 * Finds loaded threads whose ordered event batch cannot be safely ACKed until
 * an authoritative thread read has replaced the local projection.
 */
export function streamRepairThreadIds(
  events: SyncEvent[],
  projectedThreads: ReadonlyMap<string, { before: Thread; after: Thread }>,
): string[] {
  const patchesByThread = new Map<string, ThreadProjectionPatchV1[]>();
  for (const event of events) {
    const patch = threadProjectionPatchFromEvent(event.payload)
      ?? legacyThreadProjectionPatch(event.payload);
    if (patch === null) continue;
    const patches = patchesByThread.get(patch.threadId) ?? [];
    patches.push(patch);
    patchesByThread.set(patch.threadId, patches);
  }
  const repair = new Set<string>();
  for (const [threadId, patches] of patchesByThread) {
    const projection = projectedThreads.get(threadId);
    if (projection === undefined) continue;
    const nonTerminalPatches = patches.filter(({ operation }) => operation.kind !== "turnCompleted");
    if (threadProjectionNeedsAuthoritativeRepair(projection.before, nonTerminalPatches)
      || terminalProjectionRequiresRepair(projection.before, projection.after, patches)) {
      repair.add(threadId);
    }
  }
  return [...repair];
}

function terminalProjectionRequiresRepair(
  before: Thread,
  after: Thread,
  patches: readonly ThreadProjectionPatchV1[],
): boolean {
  for (const patch of patches) {
    if (patch.operation.kind !== "turnCompleted") continue;
    const turn = asRecord(patch.operation.turn);
    const turnId = typeof turn?.id === "string" ? turn.id : null;
    if (turnId === null) return true;
    const previous = before.turns.find((candidate) => candidate.id === turnId);
    const projected = after.turns.find((candidate) => candidate.id === turnId);
    if (projected === undefined || projected.status === "inProgress") return true;
    // A completed envelope without a non-empty agent boundary cannot prove
    // that all text deltas reached the read model. Repair before ACK so this
    // incomplete row never becomes an immutable cursor anchor.
    if (projected.status === "completed" && !isStableThreadCursorTurn(projected)) return true;
    // An already-loaded live turn was built from the same ordered replay
    // journal. Completion finalizes that accumulated value; a bounded server
    // replacement is unnecessary unless the companion supplied a positive
    // content witness that the projection does not satisfy.
    const terminal = asRecord(patch.operation.terminalProjection);
    const agentMessage = asRecord(terminal?.agentMessage);
    if (terminal?.version === 1
      && terminal.turnId === turnId
      && Number.isSafeInteger(agentMessage?.utf8Bytes)
      && typeof agentMessage?.sha256 === "string") {
      const proof: TerminalProjectionProof = {
        threadId: patch.threadId,
        turnId,
        agentMessage: {
          utf8Bytes: agentMessage.utf8Bytes as number,
          sha256: agentMessage.sha256,
        },
      };
      if (!terminalProjectionMatches(after, proof)) return true;
    } else if (previous === undefined && (!Array.isArray(turn?.items) || turn.items.length === 0)) {
      // A cold sparse completion cannot reconstruct a turn by itself.
      return true;
    }
  }
  return false;
}

export function terminalProjectionProofs(events: SyncEvent[]): TerminalProjectionProof[] {
  // A reconnect can replay many completed turns while the authoritative
  // repair intentionally materializes only the newest bounded history page.
  // Older proofs are therefore outside that page, not evidence of corruption.
  // Verifying the newest terminal turn per thread proves that the repaired
  // head matches the ordered event stream without requiring full history.
  const proofs = new Map<string, TerminalProjectionProof | null>();
  for (const event of events) {
    const patch = threadProjectionPatchFromEvent(event.payload);
    if (patch === null || patch.operation.kind !== "turnCompleted") continue;
    // Every newer completion supersedes an older witness, even when the newer
    // sparse notification has no usable witness of its own. Retaining the old
    // proof could compare a turn outside the bounded authoritative page.
    proofs.set(patch.threadId, null);
    const proof = asRecord(patch.operation.terminalProjection);
    const agentMessage = asRecord(proof?.agentMessage);
    if (proof?.version !== 1 || typeof proof.turnId !== "string") continue;
    if (
      !Number.isSafeInteger(agentMessage?.utf8Bytes)
      || (agentMessage?.utf8Bytes as number) < 0
      || typeof agentMessage?.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(agentMessage.sha256)
    ) continue;
    proofs.set(patch.threadId, {
      threadId: patch.threadId,
      turnId: proof.turnId,
      agentMessage: {
        utf8Bytes: agentMessage.utf8Bytes as number,
        sha256: agentMessage.sha256,
      },
    });
  }
  return [...proofs.values()].filter((proof): proof is TerminalProjectionProof => proof !== null);
}

export function terminalProjectionMatches(thread: Thread, proof: TerminalProjectionProof): boolean {
  if (thread.id !== proof.threadId) return false;
  const turn = thread.turns.find((candidate) => candidate.id === proof.turnId);
  if (turn === undefined) return false;
  const agentMessages = turn.items.filter((item) => item.type === "agentMessage");
  const message = [...agentMessages].reverse().find((item) => item.phase === "final_answer")
    ?? agentMessages.at(-1);
  if (message === undefined) return false;
  const bytes = new TextEncoder().encode(message.text);
  return bytes.length === proof.agentMessage.utf8Bytes
    && bytesToHex(sha256(bytes)) === proof.agentMessage.sha256;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
