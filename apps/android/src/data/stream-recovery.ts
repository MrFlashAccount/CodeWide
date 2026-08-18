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
  agentMessage: { utf8Bytes: number; sha256: string } | null;
};

/**
 * Finds loaded threads whose ordered event batch cannot be safely ACKed until
 * an authoritative thread read has replaced the local projection.
 */
export function streamRepairThreadIds(
  connectionId: string,
  events: SyncEvent[],
  getThread: (connectionId: string, threadId: string) => Thread | null,
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
    const thread = getThread(connectionId, threadId);
    if (thread !== null && threadProjectionNeedsAuthoritativeRepair(thread, patches)) {
      repair.add(threadId);
    }
  }
  return [...repair];
}

export function terminalProjectionProofs(events: SyncEvent[]): TerminalProjectionProof[] {
  const proofs: TerminalProjectionProof[] = [];
  for (const event of events) {
    const patch = threadProjectionPatchFromEvent(event.payload);
    if (patch === null || patch.operation.kind !== "turnCompleted") continue;
    const proof = asRecord(patch.operation.terminalProjection);
    const agentMessage = asRecord(proof?.agentMessage);
    if (proof?.version !== 1 || typeof proof.turnId !== "string") continue;
    if (proof.agentMessage === null) {
      proofs.push({ threadId: patch.threadId, turnId: proof.turnId, agentMessage: null });
      continue;
    }
    if (
      !Number.isSafeInteger(agentMessage?.utf8Bytes)
      || (agentMessage?.utf8Bytes as number) < 0
      || typeof agentMessage?.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(agentMessage.sha256)
    ) continue;
    proofs.push({
      threadId: patch.threadId,
      turnId: proof.turnId,
      agentMessage: {
        utf8Bytes: agentMessage.utf8Bytes as number,
        sha256: agentMessage.sha256,
      },
    });
  }
  return proofs;
}

export function terminalProjectionMatches(thread: Thread, proof: TerminalProjectionProof): boolean {
  if (thread.id !== proof.threadId) return false;
  const turn = thread.turns.find((candidate) => candidate.id === proof.turnId);
  if (turn === undefined) return false;
  const agentMessages = turn.items.filter((item) => item.type === "agentMessage");
  const message = [...agentMessages].reverse().find((item) => item.phase === "final_answer")
    ?? agentMessages.at(-1);
  if (proof.agentMessage === null) return message === undefined;
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
