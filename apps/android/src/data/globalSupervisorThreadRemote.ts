import { RpcResponseError } from "@codewide/sync-client";

import type { WorkspaceSyncSession } from "./workspace-session";
import { globalSupervisorLimitsV1 } from "./globalSupervisorLimitsV1";
import { globalSupervisorThreadStartParams } from "./globalSupervisorThreadProfile";
import { unknownRecord } from "./unknownRecord";
import type { VoiceAssistantPersonality } from "./voiceAssistantPersonality";

type GlobalSupervisorThreadRpc = <Result>(
  session: WorkspaceSyncSession,
  method: string,
  params: unknown,
) => Promise<Result>;

type GlobalSupervisorThreadRemote = {
  readonly findThreadsBySource: (
    connectionId: string,
    source: string,
  ) => Promise<readonly string[]>;
  readonly readThreadSource: (connectionId: string, threadId: string) => Promise<string | null>;
  readonly startThread: (connectionId: string, source: string) => Promise<string>;
};

export const GLOBAL_SUPERVISOR_THREAD_UNAVAILABLE_RPC_CODE = -32_061;

function parseThreadReadSource(value: unknown, threadId: string): string | null {
  const thread = unknownRecord(unknownRecord(value)?.thread);
  if (
    thread === null ||
    thread.id !== threadId ||
    (thread.threadSource !== null && typeof thread.threadSource !== "string")
  ) {
    throw new Error("Supervisor recovery received invalid thread metadata");
  }
  return thread.threadSource;
}

function parseBindingCatalogPage(value: unknown): {
  readonly data: readonly { readonly id: string; readonly threadSource: string | null }[];
  readonly nextCursor: string | null;
} {
  const page = unknownRecord(value);
  if (page === null || !Array.isArray(page.data)) {
    throw new Error("Supervisor reconciliation received an invalid catalog page");
  }
  const nextCursor = page.nextCursor;
  if (nextCursor !== null && (typeof nextCursor !== "string" || nextCursor.length === 0)) {
    throw new Error("Supervisor reconciliation received an invalid catalog cursor");
  }
  const data = page.data.map((candidate) => {
    const thread = unknownRecord(candidate);
    if (
      thread === null ||
      typeof thread.id !== "string" ||
      thread.id.length === 0 ||
      (thread.threadSource !== null && typeof thread.threadSource !== "string")
    ) {
      throw new Error("Supervisor reconciliation received invalid thread metadata");
    }
    return { id: thread.id, threadSource: thread.threadSource };
  });
  return { data, nextCursor };
}

/** Owns the app-server RPC payloads used to find or create the hidden supervisor thread. */
export function createGlobalSupervisorThreadRemote(options: {
  readonly getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  readonly personality: () => Promise<VoiceAssistantPersonality>;
  readonly rpcAfterAttach: GlobalSupervisorThreadRpc;
}): GlobalSupervisorThreadRemote {
  const session = (connectionId: string) => {
    const current = options.getSession(connectionId);
    if (current === undefined) {
      throw new Error("The selected Global Voice home server is not connected");
    }
    return current;
  };
  const findArchivedThreadsBySource = async (
    connectionId: string,
    source: string,
    archived: boolean,
  ): Promise<string[]> => {
    const result: string[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (;;) {
      const page = parseBindingCatalogPage(
        await options.rpcAfterAttach<unknown>(
          session(connectionId),
          "companion/supervisor/threadList",
          {
            archived,
            cursor,
            limit: globalSupervisorLimitsV1.listChatsPageMaxEntries,
            modelProviders: [],
            sourceKinds: [],
            threadSource: source,
            useStateDbOnly: true,
          },
        ),
      );
      for (const thread of page.data) {
        result.push(thread.id);
      }
      if (result.length > 1 || page.nextCursor === null) {
        return result;
      }
      if (seen.has(page.nextCursor)) {
        throw new Error("Supervisor reconciliation received a repeated catalog cursor");
      }
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  };
  return {
    async findThreadsBySource(connectionId: string, source: string): Promise<readonly string[]> {
      const result: string[] = [];
      for (const archived of [false, true]) {
        result.push(...(await findArchivedThreadsBySource(connectionId, source, archived)));
        if (result.length > 1) {
          return result;
        }
      }
      return result;
    },
    async readThreadSource(connectionId: string, threadId: string): Promise<string | null> {
      let response: unknown;
      try {
        response = await options.rpcAfterAttach<unknown>(session(connectionId), "thread/read", {
          includeTurns: false,
          threadId,
        });
      } catch (error) {
        if (
          error instanceof RpcResponseError &&
          error.code === GLOBAL_SUPERVISOR_THREAD_UNAVAILABLE_RPC_CODE
        ) {
          return null;
        }
        throw error;
      }
      return parseThreadReadSource(response, threadId);
    },
    async startThread(connectionId: string, source: string): Promise<string> {
      const personality = await options.personality();
      const response = unknownRecord(
        await options.rpcAfterAttach<unknown>(
          session(connectionId),
          "thread/start",
          globalSupervisorThreadStartParams(source, personality),
        ),
      );
      const thread = unknownRecord(response?.thread);
      if (typeof thread?.id !== "string" || thread.id.length === 0) {
        throw new Error("Supervisor creation returned an invalid thread");
      }
      return thread.id;
    },
  };
}
