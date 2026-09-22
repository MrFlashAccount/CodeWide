import { unknownRecord } from "./unknownRecord";
import { threadSummaryDescendants } from "./thread-summary-descendants";
import type { Thread, Turn } from "@codewide/codex-protocol/v0.155.1/v2";

import { projectCodexVisibleTurn } from "./codex-contextual-user-message";
import type { StoredThreadSummary } from "./thread-summary-types";

export type SubagentConversationProjection = {
  delegationPrompt: string | null;
  taskName: string | null;
  thread: Thread;
};

export class SubagentListProjection {
  private fingerprint = "";
  private value: StoredThreadSummary[] = [];

  project(summaries: readonly StoredThreadSummary[]): StoredThreadSummary[] {
    const candidates = summaries
      .filter((thread) => thread.deleteCommandId === null && thread.parentThreadId !== null)
      .sort(compareSubagentRecency);
    const fingerprint = candidates
      .map((thread) =>
        [
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
        ].join("\u0001"),
      )
      .join("\u0002");
    if (fingerprint === this.fingerprint) {
      return this.value;
    }
    this.fingerprint = fingerprint;
    this.value = candidates;
    return this.value;
  }
}

export function subagentsForThread(
  summaries: readonly StoredThreadSummary[],
  rootThreadId: string,
): StoredThreadSummary[] {
  const result = threadSummaryDescendants(summaries, rootThreadId);
  return result.sort(compareSubagentRecency);
}

// WHY: This presenter owns the established nickname, name and role fallback order; changing that
// precedence would rename existing subagents.
// oxlint-disable-next-line eslint/complexity
export function subagentDisplayName(summary: StoredThreadSummary): string {
  const nickname = summary.agentNickname?.trim();
  if (nickname !== undefined && nickname !== "") {
    return nickname;
  }
  const name = summary.name?.trim();
  if (name !== undefined && name !== "") {
    return name;
  }
  const role = summary.agentRole?.trim();
  return role === undefined || role === "" ? "Subagent" : role;
}

export function subagentIsActive(summary: StoredThreadSummary): boolean {
  return summary.status.type === "active";
}

// WHY: This adapter resolves two protocol item variants into one navigation target; their
// ambiguity and single-receiver rules must be evaluated together.
// oxlint-disable-next-line eslint/complexity
export function subagentActivityTargetThreadId(item: unknown): string | null {
  const record = unknownRecord(item);
  if (record?.type === "subAgentActivity") {
    return typeof record.agentThreadId === "string" ? nonEmpty(record.agentThreadId) : null;
  }
  if (record?.type !== "collabAgentToolCall" || !Array.isArray(record.receiverThreadIds)) {
    return null;
  }
  const receiverIds = [
    ...new Set(
      record.receiverThreadIds
        .filter((value): value is string => typeof value === "string")
        .map(nonEmpty)
        .filter((value): value is string => value !== null),
    ),
  ];
  return receiverIds.length === 1 ? (receiverIds[0] ?? null) : null;
}

/**
 * A spawned Codex thread is a fork: app-server history contains the parent's
 * transcript followed by the child's own work. The child creation timestamp is
 * the stable protocol boundary between those two histories.
 */
export function subagentOwnTurns(thread: Thread): Turn[] {
  if (thread.parentThreadId === null) {
    return thread.turns;
  }
  const childBoundaryMs = uuidV7TimestampMs(thread.id) ?? thread.createdAt * 1000;
  return thread.turns.filter((turn) => {
    const turnTimestampMs =
      uuidV7TimestampMs(turn.id) ?? (turn.startedAt === null ? null : turn.startedAt * 1000);
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
export function projectSubagentConversation(
  thread: Thread,
  parentThread: Thread | null,
): SubagentConversationProjection {
  const ownTurns = subagentOwnTurns(thread)
    .map(projectCodexVisibleTurn)
    .map(stripInjectedInput)
    .filter((turn) => turn.items.length > 0 || turn.status === "inProgress");
  const delegationPrompt = delegationPromptFromParent(parentThread, thread.id);
  const taskName = subagentTaskName(thread);
  const turns = materializeParentHandoff(ownTurns, delegationPrompt, thread);
  return {
    delegationPrompt,
    taskName,
    thread: { ...thread, preview: "", turns },
  };
}

function subagentTaskName(thread: Thread): string | null {
  const source = record(thread.source);
  const subagent = record(source?.subAgent);
  const spawn = record(subagent?.thread_spawn);
  const path = typeof spawn?.agent_path === "string" ? spawn.agent_path.trim() : "";
  if (path === "") {
    return null;
  }
  const segment = path.split("/").filter(Boolean).at(-1) ?? "";
  return segment === "" ? null : segment.replaceAll("_", " ");
}

// WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
// oxlint-disable-next-line eslint/complexity
function delegationPromptFromParent(
  parentThread: Thread | null,
  childThreadId: string,
): string | null {
  if (parentThread === null) {
    return null;
  }
  for (const turn of parentThread.turns) {
    for (const item of turn.items) {
      if (item.type !== "collabAgentToolCall" || !item.receiverThreadIds.includes(childThreadId)) {
        continue;
      }
      const prompt = item.prompt?.trim() ?? "";
      if (prompt !== "") {
        return prompt;
      }
    }
  }
  return null;
}

function stripInjectedInput(turn: Turn): Turn {
  let changed = false;
  const items = turn.items.flatMap((item): Turn["items"] => {
    if (item.type !== "userMessage") {
      return [item];
    }
    const content = item.content.filter((part) => {
      if (part.type !== "text" || !isInjectedBootstrapText(part.text)) {
        return true;
      }
      changed = true;
      return false;
    });
    if (content.length === 0) {
      changed = true;
      return [];
    }
    return content.length === item.content.length ? [item] : [{ ...item, content }];
  });
  // WHY: The flatMap callback records whether it removed injected content; TypeScript does not propagate callback mutation to this scope.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  return changed ? { ...turn, items } : turn;
}

/**
 * Subagent bootstrap input is intentionally hidden, but the delegated task is
 * still a real incoming message. Materialize it in the child timeline so the
 * ordinary conversation renderer can own messages, activities, progress, and
 * final answers exactly as it does for a root thread.
 */
// WHY: This V1 projection keeps one existing ordered decision tree; extracting branches would risk changing merge precedence during behavior-preserving cleanup.
// oxlint-disable-next-line eslint/complexity
function materializeParentHandoff(turns: Turn[], prompt: string | null, thread: Thread): Turn[] {
  const text = prompt?.trim() ?? "";
  if (text === "" || turns.some((turn) => turn.items.some((item) => item.type === "userMessage"))) {
    return turns;
  }
  const message: Turn["items"][number] = {
    clientId: null,
    content: [{ text, text_elements: [], type: "text" }],
    id: `${thread.id}:delegated-task`,
    type: "userMessage",
  };
  if (turns.length === 0) {
    return [
      {
        completedAt: thread.status.type === "active" ? null : thread.updatedAt,
        durationMs: null,
        error: null,
        id: `${thread.id}:delegated-turn`,
        items: [message],
        itemsView: "full",
        startedAt: thread.createdAt,
        status: thread.status.type === "active" ? "inProgress" : "completed",
      },
    ];
  }
  const [first, ...rest] = turns;
  if (first === undefined) {
    return turns;
  }
  return [{ ...first, items: [message, ...first.items] }, ...rest];
}

function isInjectedBootstrapText(value: string): boolean {
  const text = value.trimStart();
  return (
    text.startsWith("<recommended_plugins>") ||
    text.startsWith("# AGENTS.md instructions") ||
    text.startsWith("<AGENTS.md>") ||
    text.startsWith("<skills_instructions>") ||
    text.startsWith("<permissions instructions>") ||
    text.startsWith("<apps_instructions>") ||
    text.startsWith("<plugins_instructions>") ||
    text.startsWith("<multi_agent_mode>")
  );
}

function uuidV7TimestampMs(value: string): number | null {
  const compact = value.replaceAll("-", "");
  if (!/^[0-9a-f]{12}7[0-9a-f]{19}$/i.test(compact)) {
    return null;
  }
  const timestamp = Number.parseInt(compact.slice(0, 12), 16);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

function compareSubagentRecency(left: StoredThreadSummary, right: StoredThreadSummary): number {
  const delta = (right.recencyAt ?? right.updatedAt) - (left.recencyAt ?? left.updatedAt);
  return delta === 0 ? left.remoteThreadId.localeCompare(right.remoteThreadId) : delta;
}

function record(value: unknown): Record<string, unknown> | null {
  return unknownRecord(value);
}

function nonEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
