import { unknownRecord } from "./unknownRecord";
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { RpcClient, SyncSnapshotThread } from "@codewide/sync-client";

type IndexedSubagent = {
  agentNickname: string | null;
  agentRole: string | null;
  archived: boolean;
  cliVersion: string;
  createdAt: number;
  cwd: string;
  id: string;
  modelProvider: string;
  parentThreadId: string | null;
  source: Thread["source"];
  updatedAt: number;
};

type IndexedSubagentResponse = {
  threads: IndexedSubagent[];
};

export function subagentActivityRootThreadId(payload: Record<string, unknown>): string | null {
  // Wait for completion: item/started can race the new rollout header. The
  // Companion watcher advances the local metadata index independently of the
  // UI invalidation suppression window.
  if (payload.method !== "item/completed") {
    return null;
  }
  const params = record(payload.params);
  const item = record(params?.item);
  if (params === null || item?.type !== "subAgentActivity") {
    return null;
  }
  if (item.kind !== "started" && item.kind !== "interacted") {
    return null;
  }
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
    agentNickname: metadata.agentNickname,
    agentRole: metadata.agentRole,
    canAcceptDirectInput: null,
    cliVersion: metadata.cliVersion,
    createdAt: metadata.createdAt,
    cwd: metadata.cwd,
    daybreakEnabled: null,
    environments: null,
    ephemeral: false,
    extra: null,
    forkedFromId: null,
    gitInfo: null,
    historyMode: "paginated",
    id: metadata.id,
    model: null,
    modelProvider: metadata.modelProvider,
    name: null,
    originator: null,
    parentThreadId: metadata.parentThreadId,
    path: null,
    preview: "",
    projectId: null,
    reasoningEffort: null,
    recencyAt: metadata.updatedAt,
    section: null,
    sectionEnteredAt: null,
    sessionId: rootThreadId,
    source: metadata.source,
    status: { type: "notLoaded" },
    threadSource: null,
    turns: [],
    updatedAt: metadata.updatedAt,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return unknownRecord(value);
}
