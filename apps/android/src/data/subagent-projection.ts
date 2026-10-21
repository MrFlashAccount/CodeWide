import { unknownRecord } from "./unknownRecord";
import { threadSummaryDescendants } from "./thread-summary-descendants";

import type { StoredThreadSummary } from "./thread-summary-types";

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
          thread.subagentRootThreadId,
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
  const provenDescendantIds = new Set(
    threadSummaryDescendants(summaries, rootThreadId).map((row) => row.remoteThreadId),
  );
  const result = summaries.filter(
    (summary) =>
      provenDescendantIds.has(summary.remoteThreadId) ||
      summary.subagentRootThreadId === rootThreadId,
  );
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

function compareSubagentRecency(left: StoredThreadSummary, right: StoredThreadSummary): number {
  const delta = (right.recencyAt ?? right.updatedAt) - (left.recencyAt ?? left.updatedAt);
  return delta === 0 ? left.remoteThreadId.localeCompare(right.remoteThreadId) : delta;
}

function nonEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
