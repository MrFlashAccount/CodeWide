import type { RenderBlock } from "@codewide/renderers";

const RUNNING_STATUSES: ReadonlySet<string> = new Set(["inProgress", "running"]);

/**
 * Whether a tool call still runs. A reported status is the provider's
 * lifecycle and is authoritative: a terminal status is never shown running,
 * whatever its position or output. Only an item that reports no status
 * falls back to position: the newest item of a running turn.
 */
export function isToolCallRunning(block: RenderBlock, newestOfRunningTurn: boolean): boolean {
  return block.status === null ? newestOfRunningTurn : RUNNING_STATUSES.has(block.status);
}
