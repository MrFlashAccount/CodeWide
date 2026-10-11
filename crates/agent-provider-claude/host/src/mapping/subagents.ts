/**
 * Sub-agents Claude starts with its `Agent` (formerly `Task`) tool, as neutral
 * `subagent` items, and the child thread id of each sub-agent's transcript.
 *
 * The same rules serve live frames and stored history:
 * - the item starts `running` from the tool input;
 * - the spawning call's result names the agent (`tool_use_result.agentId`
 *   live, the `agentId: <id>` line of the result text in both); a background
 *   launch keeps it `running`, a foreground result completes it;
 * - a task notification (`<task-notification>` message in history, a
 *   `task_notification` system frame live) carries the final status.
 *
 * Child thread id: `<app thread id>:agent:<agent id>`. Claude's agent ids are
 * unique within a session and its sub-agents, so the id is stable across
 * reads and equal live and in history. Pure; no I/O.
 */

import type { AgentItem, AppThreadId, SubagentStatus } from "../protocol.js";
import { asAppThreadId, asItemId } from "../protocol.js";
import { isRecord, type JsonRecord, type ToolResultBlock } from "./frames.js";

/** Tool names that start a sub-agent (`Task` is the former name of `Agent`). */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(["Agent", "Task"]);

const AGENT_THREAD_SEPARATOR = ":agent:";
const AGENT_ID_LINE = /^agentId: ([\w-]+)/mu;
const ASYNC_LAUNCH = "Async agent launched";
const NOTIFICATION_TASK_ID = /<task-id>([\w-]+)<\/task-id>/u;
const NOTIFICATION_TOOL_USE_ID = /<tool-use-id>([\w-]+)<\/tool-use-id>/u;
const NOTIFICATION_STATUS = /<status>([a-z_]+)<\/status>/u;

export type SubagentItem = Extract<AgentItem, { readonly type: "subagent" }>;

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

export const isSubagentTool = (name: string): boolean => SUBAGENT_TOOLS.has(name);

/** The child thread of a sub-agent's transcript. */
export const subagentThreadId = (appThreadId: AppThreadId, agentId: string): AppThreadId =>
  asAppThreadId(`${appThreadId}${AGENT_THREAD_SEPARATOR}${agentId}`);

/** The in-progress item for an `Agent` tool call. */
export function startSubagent(toolUseId: string, input: JsonRecord): SubagentItem {
  return {
    agentThreadId: null,
    agentType: str(input["subagent_type"]),
    background: input["run_in_background"] === true,
    description: str(input["description"]) ?? "",
    itemId: asItemId(toolUseId),
    model: str(input["model"]),
    prompt: str(input["prompt"]) ?? "",
    result: null,
    status: "running",
    type: "subagent",
  };
}

/** The agent id the spawning call's result names, or `null`. */
export function spawnedAgentId(result: ToolResultBlock, toolUseResult: unknown): string | null {
  const structured = isRecord(toolUseResult) ? str(toolUseResult["agentId"]) : null;
  return structured ?? AGENT_ID_LINE.exec(result.text)?.[1] ?? null;
}

const isAsyncLaunch = (result: ToolResultBlock, toolUseResult: unknown): boolean =>
  (isRecord(toolUseResult) &&
    (toolUseResult["isAsync"] === true || toolUseResult["status"] === "async_launched")) ||
  result.text.startsWith(ASYNC_LAUNCH);

/** The agent's answer without the trailing agent id and usage block Claude appends. */
function answerText(result: ToolResultBlock): string {
  const cut = AGENT_ID_LINE.exec(result.text)?.index ?? result.text.length;
  return result.text.slice(0, cut).trimEnd();
}

/** How the spawning call ended. */
export interface SubagentOutcome {
  readonly appThreadId: AppThreadId;
  /** The call completed (not refused, cancelled or an error result). */
  readonly completed: boolean;
  readonly result: ToolResultBlock;
  readonly toolUseResult: unknown;
}

/** The item after its spawning call returned. */
export function completeSubagent(started: SubagentItem, outcome: SubagentOutcome): SubagentItem {
  const agentId = spawnedAgentId(outcome.result, outcome.toolUseResult);
  const agentThreadId =
    agentId === null ? started.agentThreadId : subagentThreadId(outcome.appThreadId, agentId);
  if (!outcome.completed) {
    return { ...started, agentThreadId, result: outcome.result.text, status: "failed" };
  }
  if (isAsyncLaunch(outcome.result, outcome.toolUseResult)) {
    return { ...started, agentThreadId, background: true };
  }
  return { ...started, agentThreadId, result: answerText(outcome.result), status: "completed" };
}

/** The agent thread once Claude names the agent (`task_started`), before the call returns. */
export function withAgent(
  item: SubagentItem,
  appThreadId: AppThreadId,
  agentId: string,
): SubagentItem {
  return { ...item, agentThreadId: subagentThreadId(appThreadId, agentId) };
}

/** A sub-agent's status as a task notification reports it, or `null` for a status that is not final. */
export function notifiedStatus(status: string | null): SubagentStatus | null {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "killed":
    case "stopped":
      return "stopped";
    case null:
    default:
      return null;
  }
}

/** The facts of a stored `<task-notification>` message. */
export interface TaskNotification {
  readonly status: SubagentStatus | null;
  readonly taskId: string;
  readonly toolUseId: string | null;
}

export function taskNotificationOf(text: string): TaskNotification | null {
  const taskId = NOTIFICATION_TASK_ID.exec(text)?.[1];
  if (taskId === undefined) {
    return null;
  }
  return {
    status: notifiedStatus(NOTIFICATION_STATUS.exec(text)?.[1] ?? null),
    taskId,
    toolUseId: NOTIFICATION_TOOL_USE_ID.exec(text)?.[1] ?? null,
  };
}

/** The item with a later status; a turn ending under a running foreground agent stops it. */
export const withStatus = (item: SubagentItem, status: SubagentStatus): SubagentItem =>
  item.status === status ? item : { ...item, status };

/** The agent id of a child thread this module named, or `null`. */
export function agentIdOf(agentThreadId: AppThreadId): string | null {
  const at = agentThreadId.lastIndexOf(AGENT_THREAD_SEPARATOR);
  return at < 0 ? null : agentThreadId.slice(at + AGENT_THREAD_SEPARATOR.length);
}

/** The latest final status each notified sub-agent reported, by spawning call and by agent id. */
export class NotifiedStatuses {
  private readonly byAgent = new Map<string, SubagentStatus>();
  private readonly byToolUse = new Map<string, SubagentStatus>();

  public record(notification: TaskNotification): void {
    if (notification.status === null) {
      return;
    }
    this.byAgent.set(notification.taskId, notification.status);
    if (notification.toolUseId !== null) {
      this.byToolUse.set(notification.toolUseId, notification.status);
    }
  }

  /** The item with the status a later notification reported; only a running item changes. */
  public apply(item: SubagentItem): SubagentItem {
    if (item.status !== "running") {
      return item;
    }
    const agentId = item.agentThreadId === null ? null : agentIdOf(item.agentThreadId);
    const status =
      this.byToolUse.get(item.itemId) ?? (agentId === null ? undefined : this.byAgent.get(agentId));
    return status === undefined ? item : withStatus(item, status);
  }
}
