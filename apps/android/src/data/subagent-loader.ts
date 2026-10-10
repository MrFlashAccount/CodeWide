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

/** A live event after which the Companion's descendant index may list a new or changed subagent. */
export type SubagentActivity = {
  readonly rootThreadId: string;
  /**
   * The spawn has only begun: the agent's transcript reaches the index a moment later, so one
   * read can still miss it.
   */
  readonly spawning: boolean;
};

export function subagentActivity(payload: Record<string, unknown>): SubagentActivity | null {
  const params = record(payload.params);
  const item = record(params?.item);
  if (params === null || item === null || typeof params.threadId !== "string") {
    return null;
  }
  const rootThreadId = params.threadId;
  // Codex: wait for completion, because item/started can race the new rollout header. The
  // Companion watcher advances the local metadata index independently of the UI invalidation
  // suppression window.
  if (item.type === "subAgentActivity") {
    return payload.method === "item/completed" &&
      (item.kind === "started" || item.kind === "interacted")
      ? { rootThreadId, spawning: false }
      : null;
  }
  // Claude: its agents are never announced as threads. The spawning call is the only live
  // signal, and a foreground call completes only when its agent has finished.
  if (item.type === "collabAgentToolCall" && item.tool === "spawnAgent") {
    if (payload.method === "item/started") {
      return { rootThreadId, spawning: true };
    }
    return payload.method === "item/completed" ? { rootThreadId, spawning: false } : null;
  }
  return null;
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
