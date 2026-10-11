import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";

/**
 * Another process holds the thread (for example a Claude background agent):
 * the server refuses direct input until it lets go. An unloaded thread
 * (`canAcceptDirectInput: null`) still accepts a turn.
 */
export function threadOpenElsewhere(thread: Thread | null | undefined): boolean {
  return thread?.canAcceptDirectInput === false;
}
