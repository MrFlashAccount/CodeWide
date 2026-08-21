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
  projectedThreads: ReadonlyMap<string, { before: Thread }>,
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
    const thread = projectedThreads.get(threadId)?.before;
    if (thread !== undefined && threadProjectionNeedsAuthoritativeRepair(thread, patches)) {
      repair.add(threadId);
    }
  }
  return [...repair];
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
