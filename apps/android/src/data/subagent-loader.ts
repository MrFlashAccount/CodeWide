import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { RpcClient, SyncSnapshotThread } from "@codewide/sync-client";

type IndexedSubagent = {
  id: string;
  parentThreadId: string | null;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  modelProvider: string;
  cliVersion: string;
  source: Thread["source"];
  agentNickname: string | null;
  agentRole: string | null;
  archived: boolean;
};

type IndexedSubagentResponse = {
  threads: IndexedSubagent[];
};

export function subagentActivityRootThreadId(payload: Record<string, unknown>): string | null {
  // Wait for completion: item/started can race the new rollout header. The
  // Companion watcher advances the local metadata index independently of the
  // UI invalidation suppression window.
  if (payload.method !== "item/completed") return null;
  const params = record(payload.params);
  const item = record(params?.item);
  if (params === null || item?.type !== "subAgentActivity") return null;
  if (item.kind !== "started" && item.kind !== "interacted") return null;
  return typeof params.threadId === "string" ? params.threadId : null;
}

/** Load one descendant tree from the Companion's canonical parent index. */
export async function loadSubagentDescendants(
  session: RpcClient,
  rootThreadId: string,
): Promise<SyncSnapshotThread[]> {
  const response = await session.rpc<IndexedSubagentResponse>("companion/threadSubagents/read", {
    threadId: rootThreadId,
  });
  return response.threads.map((metadata) => ({
    archived: metadata.archived,
    thread: indexedSubagentThread(metadata, rootThreadId),
  }));
}

function indexedSubagentThread(metadata: IndexedSubagent, rootThreadId: string): Thread {
  return {
    id: metadata.id,
    extra: null,
    sessionId: rootThreadId,
    forkedFromId: null,
    parentThreadId: metadata.parentThreadId,
    preview: "",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    historyMode: "paginated",
    modelProvider: metadata.modelProvider,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    recencyAt: metadata.updatedAt,
    status: { type: "notLoaded" },
    path: null,
    cwd: metadata.cwd,
    cliVersion: metadata.cliVersion,
    source: metadata.source,
    canAcceptDirectInput: null,
    threadSource: null,
    agentNickname: metadata.agentNickname,
    agentRole: metadata.agentRole,
    gitInfo: null,
    name: null,
    turns: [],
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
