import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";

import type { StoredThreadSummary } from "./thread-summary-types";

export type SubagentConversationProjection = {
  thread: Thread;
  delegationPrompt: string | null;
  taskName: string | null;
};

export class SubagentListProjection {
  private fingerprint = "";
  private value: StoredThreadSummary[] = [];

  project(summaries: readonly StoredThreadSummary[]): StoredThreadSummary[] {
    const candidates = summaries
      .filter((thread) => thread.deleteCommandId == null && thread.parentThreadId != null)
      .sort(compareSubagentRecency);
    const fingerprint = candidates.map((thread) => [
      thread.connectionId,
      thread.remoteThreadId,
      thread.parentThreadId,
      thread.updatedAt,
      thread.recencyAt,
      thread.status.type,
      thread.name,
      thread.agentNickname,
      thread.agentRole,
      thread.preview,
    ].join("\u0001")).join("\u0002");
    if (fingerprint === this.fingerprint) return this.value;
    this.fingerprint = fingerprint;
    this.value = candidates;
    return this.value;
  }
}

export function subagentsForThread(
  summaries: readonly StoredThreadSummary[],
  rootThreadId: string,
): StoredThreadSummary[] {
  const descendants = new Set([rootThreadId]);
  const result: StoredThreadSummary[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const summary of summaries) {
      if (summary.parentThreadId == null || !descendants.has(summary.parentThreadId) || descendants.has(summary.remoteThreadId)) continue;
      descendants.add(summary.remoteThreadId);
      result.push(summary);
      changed = true;
    }
  }
  return result.sort(compareSubagentRecency);
}

export function subagentDisplayName(summary: StoredThreadSummary): string {
  return summary.agentNickname?.trim()
    || summary.name?.trim()
    || summary.agentRole?.trim()
    || "Subagent";
}

export function subagentIsActive(summary: StoredThreadSummary): boolean {
  return summary.status.type === "active";
}

export function subagentActivityTargetThreadId(item: Turn["items"][number]): string | null {
  if (item.type === "subAgentActivity") return nonEmpty(item.agentThreadId);
  if (item.type !== "collabAgentToolCall") return null;
  const receiverIds = [...new Set(item.receiverThreadIds.map(nonEmpty).filter((value): value is string => value !== null))];
  return receiverIds.length === 1 ? receiverIds[0] ?? null : null;
}

/**
 * A spawned Codex thread is a fork: app-server history contains the parent's
 * transcript followed by the child's own work. The child creation timestamp is
 * the stable protocol boundary between those two histories.
 */
export function subagentOwnTurns(thread: Thread): Turn[] {
  if (thread.parentThreadId == null) return thread.turns;
  const childBoundaryMs = uuidV7TimestampMs(thread.id) ?? thread.createdAt * 1_000;
  return thread.turns.filter((turn) => {
    const turnTimestampMs = uuidV7TimestampMs(turn.id) ?? (turn.startedAt === null ? null : turn.startedAt * 1_000);
    return turnTimestampMs !== null && turnTimestampMs >= childBoundaryMs;
  });
}

/**
 * Produces the read-only child conversation without leaking either the forked
 * parent transcript or injected user-role bootstrap instructions. Older collab
 * events expose the real delegated prompt on the parent tool call. MultiAgent
 * v2 currently exposes only subAgentActivity, so callers fall back to the
 * stable task name from the child source metadata instead of showing bootstrap
 * material as if the user had written it.
 */
export function projectSubagentConversation(thread: Thread, parentThread: Thread | null): SubagentConversationProjection {
  const ownTurns = subagentOwnTurns(thread).map(stripInjectedInput).filter((turn) => (
    turn.items.length > 0 || turn.status === "inProgress"
  ));
  const delegationPrompt = delegationPromptFromParent(parentThread, thread.id);
  const taskName = subagentTaskName(thread);
  const turns = materializeParentHandoff(ownTurns, delegationPrompt, thread);
  return {
    thread: { ...thread, preview: "", turns },
    delegationPrompt,
    taskName,
  };
}

export function subagentTaskName(thread: Thread): string | null {
  const source = record(thread.source);
  const subagent = record(source?.subAgent);
  const spawn = record(subagent?.thread_spawn);
  const path = typeof spawn?.agent_path === "string" ? spawn.agent_path.trim() : "";
  if (path === "") return null;
  const segment = path.split("/").filter(Boolean).at(-1) ?? "";
  return segment === "" ? null : segment.replaceAll("_", " ");
}

function delegationPromptFromParent(parentThread: Thread | null, childThreadId: string): string | null {
  if (parentThread === null) return null;
  for (const turn of parentThread.turns) {
    for (const item of turn.items) {
      if (item.type !== "collabAgentToolCall" || !item.receiverThreadIds.includes(childThreadId)) continue;
      const prompt = item.prompt?.trim() ?? "";
      if (prompt !== "") return prompt;
    }
  }
  return null;
}

function stripInjectedInput(turn: Turn): Turn {
  let changed = false;
  const items = turn.items.flatMap((item): Turn["items"] => {
    if (item.type !== "userMessage") return [item];
    const content = item.content.filter((part) => {
      if (part.type !== "text" || !isInjectedBootstrapText(part.text)) return true;
      changed = true;
      return false;
    });
    if (content.length === 0) {
      changed = true;
      return [];
    }
    return content.length === item.content.length ? [item] : [{ ...item, content }];
  });
  return changed ? { ...turn, items } : turn;
}

/**
 * Subagent bootstrap input is intentionally hidden, but the delegated task is
 * still a real incoming message. Materialize it in the child timeline so the
 * ordinary conversation renderer can own messages, activities, progress, and
 * final answers exactly as it does for a root thread.
 */
function materializeParentHandoff(turns: Turn[], prompt: string | null, thread: Thread): Turn[] {
  const text = prompt?.trim() ?? "";
  if (text === "" || turns.some((turn) => turn.items.some((item) => item.type === "userMessage"))) return turns;
  const message: Turn["items"][number] = {
    type: "userMessage",
    id: `${thread.id}:delegated-task`,
    clientId: null,
    content: [{ type: "text", text, text_elements: [] }],
  };
  if (turns.length === 0) {
    return [{
      id: `${thread.id}:delegated-turn`,
      items: [message],
      itemsView: "full",
      status: thread.status.type === "active" ? "inProgress" : "completed",
      error: null,
      startedAt: thread.createdAt,
      completedAt: thread.status.type === "active" ? null : thread.updatedAt,
      durationMs: null,
    }];
  }
  const [first, ...rest] = turns;
  if (first === undefined) return turns;
  return [{ ...first, items: [message, ...first.items] }, ...rest];
}

function isInjectedBootstrapText(value: string): boolean {
  const text = value.trimStart();
  return text.startsWith("<recommended_plugins>")
    || text.startsWith("# AGENTS.md instructions")
    || text.startsWith("<AGENTS.md>")
    || text.startsWith("<environment_context>")
    || text.startsWith("<skills_instructions>")
    || text.startsWith("<permissions instructions>")
    || text.startsWith("<apps_instructions>")
    || text.startsWith("<plugins_instructions>")
    || text.startsWith("<multi_agent_mode>");
}

function uuidV7TimestampMs(value: string): number | null {
  const compact = value.replaceAll("-", "");
  if (!/^[0-9a-f]{12}7[0-9a-f]{19}$/i.test(compact)) return null;
  const timestamp = Number.parseInt(compact.slice(0, 12), 16);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

function compareSubagentRecency(left: StoredThreadSummary, right: StoredThreadSummary): number {
  const delta = (right.recencyAt ?? right.updatedAt) - (left.recencyAt ?? left.updatedAt);
  return delta === 0 ? left.remoteThreadId.localeCompare(right.remoteThreadId) : delta;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
