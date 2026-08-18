import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

/**
 * `thread/list` may omit the projected parent field for an unscoped subagent
 * query even though the canonical spawn metadata is still present in
 * `source`. Restore that relationship before any cache projects roots and
 * descendants from the snapshot.
 */
export function restoreSubagentParent(thread: Thread): Thread {
  if (thread.parentThreadId !== null) return thread;
  const source = thread.source;
  if (typeof source !== "object" || source === null || !("subAgent" in source)) return thread;
  const subagent = source.subAgent;
  if (typeof subagent !== "object" || subagent === null || !("thread_spawn" in subagent)) return thread;
  const spawn = subagent.thread_spawn;
  if (typeof spawn !== "object" || spawn === null || !("parent_thread_id" in spawn)) return thread;
  const parentThreadId = spawn.parent_thread_id;
  return typeof parentThreadId === "string" && parentThreadId !== ""
    ? { ...thread, parentThreadId }
    : thread;
}
