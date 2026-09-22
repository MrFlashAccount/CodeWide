import {
  GLOBAL_SUPERVISOR_WORKER_SOURCE_PREFIX,
  type GlobalSupervisorAttentionOwner,
} from "./globalSupervisorAttention";
import {
  globalSupervisorQualifiedChatRef,
  type GlobalSupervisorQualifiedChatRef,
} from "./globalSupervisorBinding";
import type { StoredConnection } from "./connection-profile-types";
import { globalSupervisorLimitsV1 } from "./globalSupervisorLimitsV1";
import {
  collectGlobalSupervisorTurnHistoryItems,
  globalSupervisorCatalogCursor,
  globalSupervisorHistoryCursor,
  parseGlobalSupervisorCatalogCursor,
  parseGlobalSupervisorCatalogPage,
  parseGlobalSupervisorHistoryCursor,
  parseGlobalSupervisorTurnHistoryPage,
} from "./globalSupervisorToolPagination";
import type { GlobalSupervisorToolCapabilities } from "./globalSupervisorToolRouter";
import type { GlobalSupervisorToolTargetPolicy } from "./globalSupervisorToolTarget";
import type { WorkspaceSyncSession } from "./workspace-session";
import { unknownRecord } from "./unknownRecord";

type GlobalSupervisorToolsAuthority = {
  readonly attention: GlobalSupervisorAttentionOwner;
  readonly currentConnections: () => StoredConnection[];
  readonly deriveTargetSendCommandId: GlobalSupervisorToolCapabilities["deriveTargetSendCommandId"];
  readonly deriveWorkerCreationSource: GlobalSupervisorToolCapabilities["deriveWorkerCreationSource"];
  readonly getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  readonly isRpcAvailable: (connectionId: string) => boolean;
  readonly respond: GlobalSupervisorToolCapabilities["respond"];
  readonly rpcAfterAttach: <Result>(
    session: WorkspaceSyncSession,
    method: string,
    params: unknown,
  ) => Promise<Result>;
  readonly sendSystemText: (request: {
    readonly commandId: string;
    readonly connectionId: string;
    readonly text: string;
    readonly threadId: string;
  }) => Promise<string>;
  readonly targetPolicy: GlobalSupervisorToolTargetPolicy;
};

function requireLiveConnection(
  authority: GlobalSupervisorToolsAuthority,
  connectionId: string,
): WorkspaceSyncSession {
  const connection = authority
    .currentConnections()
    .find((candidate) => candidate.id === connectionId && candidate.enabled);
  const session = authority.getSession(connectionId);
  if (
    connection === undefined ||
    session === undefined ||
    !authority.isRpcAvailable(connectionId)
  ) {
    throw new Error("The target chat server is not live");
  }
  return session;
}

function requireLiveTarget(
  authority: GlobalSupervisorToolsAuthority,
  target: GlobalSupervisorQualifiedChatRef,
): WorkspaceSyncSession {
  if (!authority.targetPolicy.allowsTarget(target.connectionId, target.threadId)) {
    throw new Error("The supervisor thread is not a valid tool target");
  }
  return requireLiveConnection(authority, target.connectionId);
}

/** Owns validated bounded catalog/history reads and non-optimistic target delivery. */
export function createGlobalSupervisorToolCapabilities(
  authority: GlobalSupervisorToolsAuthority,
): GlobalSupervisorToolCapabilities {
  return {
    assertLiveTarget(target) {
      requireLiveTarget(authority, target);
    },
    async createChat(request) {
      const capturedSession = requireLiveConnection(authority, request.connectionId);
      await authority.attention.beginWorkerCreation({
        source: request.source,
        supervisor: request.supervisor,
        workerConnectionId: request.connectionId,
      });
      const response = unknownRecord(
        await authority.rpcAfterAttach<unknown>(
          capturedSession,
          "thread/start",
          request.cwd === null
            ? { threadSource: request.source }
            : { cwd: request.cwd, threadSource: request.source },
        ),
      );
      const thread = unknownRecord(response?.thread);
      if (typeof thread?.id !== "string" || thread.id.length === 0) {
        throw new Error("Worker chat creation returned an invalid thread");
      }
      const worker = globalSupervisorQualifiedChatRef(request.connectionId, thread.id);
      await authority.attention.completeWorkerCreation({ source: request.source, worker });
      return worker;
    },
    async deriveTargetSendCommandId(request) {
      return authority.deriveTargetSendCommandId(request);
    },
    async deriveWorkerCreationSource(request) {
      return `${GLOBAL_SUPERVISOR_WORKER_SOURCE_PREFIX}${await authority.deriveWorkerCreationSource(request)}`;
    },
    async followChat(supervisor, target) {
      await authority.attention.follow(supervisor, target);
    },
    async listChats(cursor, limit) {
      const connections = authority.currentConnections().filter((connection) => connection.enabled);
      const connectionOrder = connections.map((connection) => connection.id);
      const position = parseGlobalSupervisorCatalogCursor(cursor, connectionOrder);
      const connection = connections[position.connectionIndex];
      if (connection === undefined) {
        return { cursor: null, items: [] };
      }
      const session = requireLiveConnection(authority, connection.id);
      const boundedLimit = Math.min(limit, globalSupervisorLimitsV1.listChatsPageMaxEntries);
      const page = parseGlobalSupervisorCatalogPage(
        await authority.rpcAfterAttach<unknown>(session, "thread/list", {
          archived: false,
          cursor: position.remoteCursor,
          limit: boundedLimit,
          modelProviders: [],
          sourceKinds: [],
          useStateDbOnly: true,
        }),
        boundedLimit,
        position.remoteCursor,
      );
      const items = page.data.map((thread) => ({
        ...globalSupervisorQualifiedChatRef(connection.id, thread.id),
        preview: thread.preview,
        title: thread.name ?? thread.preview.split("\n", 1)[0] ?? "Untitled chat",
      }));
      const nextConnectionIndex =
        page.nextCursor === null ? position.connectionIndex + 1 : position.connectionIndex;
      const nextConnection = connections[nextConnectionIndex];
      const nextCursor =
        nextConnection === undefined
          ? null
          : globalSupervisorCatalogCursor(nextConnection.id, connectionOrder, page.nextCursor);
      return { cursor: nextCursor, items };
    },
    async readChat(request) {
      if (
        !authority.targetPolicy.allowsTarget(request.target.connectionId, request.target.threadId)
      ) {
        throw new Error("The supervisor thread is not a valid tool target");
      }
      const cursor = parseGlobalSupervisorHistoryCursor(request.cursor, request.target);
      const session = requireLiveTarget(authority, request.target);
      const boundedLimit = Math.min(request.limit, globalSupervisorLimitsV1.readChatPageMaxItems);
      const page = parseGlobalSupervisorTurnHistoryPage(
        await authority.rpcAfterAttach<unknown>(session, "thread/turns/list", {
          cursor: cursor.remoteCursor,
          // readChat exposes conversation text only. The summary contract
          // prevents App Server from rematerializing historical tool output
          // before Companion can externalize it.
          itemsView: "summary",
          limit: 1,
          sortDirection: "asc",
          threadId: request.target.threadId,
        }),
        cursor.remoteCursor,
      );
      const sourceItems = page.turn?.items ?? [];
      if (cursor.itemOffset > sourceItems.length) {
        throw new Error("The readChat cursor is invalid");
      }
      const collected = collectGlobalSupervisorTurnHistoryItems(page, {
        initialOffset: cursor.itemOffset,
        limit: boundedLimit,
        maxBytes: Math.min(request.maxBytes, globalSupervisorLimitsV1.readChatPageMaxBytes),
      });
      const nextCursor =
        collected.itemOffset < sourceItems.length
          ? globalSupervisorHistoryCursor(request.target, cursor.remoteCursor, collected.itemOffset)
          : globalSupervisorHistoryCursor(request.target, page.nextCursor, 0);
      return { cursor: nextCursor, items: collected.items };
    },
    respond: authority.respond,
    async sendText(request) {
      const capturedSession = requireLiveTarget(authority, request.target);
      if (
        authority.getSession(request.target.connectionId) !== capturedSession ||
        !authority.isRpcAvailable(request.target.connectionId)
      ) {
        throw new Error("The target chat authority changed before delivery");
      }
      await authority.attention.follow(request.supervisor, request.target);
      return authority.sendSystemText({
        commandId: request.commandId,
        connectionId: request.target.connectionId,
        text: request.text,
        threadId: request.target.threadId,
      });
    },
    async unfollowChat(supervisor, target) {
      await authority.attention.unfollow(supervisor, target);
    },
  };
}
