import type { V2ThreadSummary } from "@codewide/sync-client/v2";

import type { AgentWorkspaceRow } from "./AgentsWorkspace";

export function agentWorkspaceRows(agents: readonly V2ThreadSummary[]): AgentWorkspaceRow[] {
  return agents.map((thread): AgentWorkspaceRow => {
    return {
      active: thread.state === "running",
      id: thread.id,
      subtitle: `${thread.state} · ${thread.workspace}`,
      time: formatAgentTime(thread.lastActivityAt ?? thread.updatedAt),
      title: thread.title ?? "Agent thread",
    };
  });
}

function formatAgentTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
