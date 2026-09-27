import {
  GLOBAL_SUPERVISOR_WORKER_SOURCE_PREFIX,
  type GlobalSupervisorAttentionOwner,
  type GlobalSupervisorSpokenAttentionPolicy,
} from "./globalSupervisorAttention";
import {
  globalSupervisorQualifiedChatRef,
  type GlobalSupervisorQualifiedChatRef,
} from "./globalSupervisorBinding";
import type { StoredConnection } from "./connection-profile-types";
import {
  projectGlobalSupervisorChatAttachments,
  readGlobalSupervisorChatAttachmentText,
  resolveGlobalSupervisorChatAttachment,
  type GlobalSupervisorAttachmentTextReader,
} from "./globalSupervisorChatAttachments";
import { projectGlobalSupervisorChatInspection } from "./globalSupervisorChatInspection";
import { globalSupervisorLimitsV1 } from "./globalSupervisorLimitsV1";
import {
  globalSupervisorPendingRequestEventId,
  globalSupervisorPendingRequestResult,
  projectGlobalSupervisorPendingRequest,
  type GlobalSupervisorPendingRequestSummary,
} from "./globalSupervisorPendingRequest";
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
import type { PendingServerRequest } from "./pending-request-types";
import type { StoredThreadSummary } from "./thread-summary-types";
import type { WorkspaceSyncSession } from "./workspace-session";
import { unknownRecord } from "./unknownRecord";
import {
  findGlobalSupervisorChat,
  projectGlobalSupervisorActiveWork,
} from "./globalSupervisorWorkSnapshot";

const MILLISECONDS_PER_MINUTE = 60_000;

type GlobalSupervisorToolsAuthority = {
  readonly attention: GlobalSupervisorAttentionOwner;
  readonly currentConnections: () => StoredConnection[];
  readonly currentPendingRequests: () => readonly PendingServerRequest[];
  readonly deriveTargetSendCommandId: GlobalSupervisorToolCapabilities["deriveTargetSendCommandId"];
  readonly deriveWorkerCreationSource: GlobalSupervisorToolCapabilities["deriveWorkerCreationSource"];
  readonly getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  readonly isRpcAvailable: (connectionId: string) => boolean;
  readonly now: () => number;
  readonly readAttachmentText: GlobalSupervisorAttachmentTextReader;
  readonly readWorkCatalog: () => Promise<readonly StoredThreadSummary[]>;
  readonly respond: GlobalSupervisorToolCapabilities["respond"];
  readonly respondToPendingRequest: (
    request: PendingServerRequest,
    result: unknown,
  ) => Promise<void>;
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

function parseWorkerSourcePage(value: unknown): {
  readonly data: readonly string[];
  readonly nextCursor: string | null;
} {
  const page = unknownRecord(value);
  if (page === null || !Array.isArray(page.data)) {
    throw new Error("Worker recovery received an invalid catalog page");
  }
  if (page.nextCursor !== null && typeof page.nextCursor !== "string") {
    throw new Error("Worker recovery received an invalid catalog cursor");
  }
  const data = page.data.map((candidate) => {
    const thread = unknownRecord(candidate);
    if (typeof thread?.id !== "string" || thread.id.length === 0) {
      throw new Error("Worker recovery received invalid thread metadata");
    }
    return thread.id;
  });
  return { data, nextCursor: page.nextCursor };
}

async function findWorkerBySource(
  authority: GlobalSupervisorToolsAuthority,
  session: WorkspaceSyncSession,
  source: string,
): Promise<string | null> {
  const matches: string[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page = parseWorkerSourcePage(
      await authority.rpcAfterAttach<unknown>(session, "companion/supervisor/threadList", {
        archived: false,
        cursor,
        limit: globalSupervisorLimitsV1.listChatsPageMaxEntries,
        modelProviders: [],
        sourceKinds: [],
        threadSource: source,
        useStateDbOnly: true,
      }),
    );
    matches.push(...page.data);
    if (matches.length > 1) {
      throw new Error("Worker task identity resolved to more than one visible chat");
    }
    if (page.nextCursor === null) {
      return matches[0] ?? null;
    }
    if (seenCursors.has(page.nextCursor)) {
      throw new Error("Worker recovery received a repeated catalog cursor");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

function requestTarget(request: PendingServerRequest): GlobalSupervisorQualifiedChatRef | null {
  const params = unknownRecord(request.params);
  return typeof params?.threadId === "string" && params.threadId.length > 0
    ? globalSupervisorQualifiedChatRef(request.connectionId, params.threadId)
    : null;
}

function qualifiedKey(target: GlobalSupervisorQualifiedChatRef): string {
  return `${target.connectionId}\u0000${target.threadId}`;
}

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

async function createWorkerChat(
  authority: GlobalSupervisorToolsAuthority,
  session: WorkspaceSyncSession,
  request: Parameters<GlobalSupervisorToolCapabilities["startTask"]>[0],
): Promise<GlobalSupervisorQualifiedChatRef> {
  await authority.attention.beginWorkerCreation({
    source: request.source,
    supervisor: request.supervisor,
    workerConnectionId: request.connectionId,
  });
  const response = unknownRecord(
    await authority.rpcAfterAttach<unknown>(
      session,
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
  return globalSupervisorQualifiedChatRef(request.connectionId, thread.id);
}

async function createOrRecoverWorkerChat(
  authority: GlobalSupervisorToolsAuthority,
  session: WorkspaceSyncSession,
  request: Parameters<GlobalSupervisorToolCapabilities["startTask"]>[0],
): Promise<GlobalSupervisorQualifiedChatRef> {
  const existingThreadId = await findWorkerBySource(authority, session, request.source);
  return existingThreadId === null
    ? createWorkerChat(authority, session, request)
    : globalSupervisorQualifiedChatRef(request.connectionId, existingThreadId);
}

/** Owns validated bounded catalog/history reads and non-optimistic target delivery. */
export function createGlobalSupervisorToolCapabilities(
  authority: GlobalSupervisorToolsAuthority,
): GlobalSupervisorToolCapabilities {
  return {
    assertLiveTarget(target) {
      requireLiveTarget(authority, target);
    },
    async deriveTargetSendCommandId(request) {
      return authority.deriveTargetSendCommandId(request);
    },
    async deriveWorkerCreationSource(request) {
      return `${GLOBAL_SUPERVISOR_WORKER_SOURCE_PREFIX}${await authority.deriveWorkerCreationSource(request)}`;
    },
    async findChat(supervisor, request) {
      const availableConnectionIds = new Set(
        authority
          .currentConnections()
          .filter((connection) => connection.enabled && authority.isRpcAvailable(connection.id))
          .map((connection) => connection.id),
      );
      const rows = await authority.readWorkCatalog();
      return findGlobalSupervisorChat({
        availableConnectionIds,
        connectionId: request.connectionId,
        hiddenSupervisor: supervisor,
        project: request.project,
        rows,
        title: request.title,
        topic: request.topic,
      });
    },
    async followChat(supervisor, target) {
      await authority.attention.follow(supervisor, target);
    },
    async inspectChat(target) {
      const session = requireLiveTarget(authority, target);
      return projectGlobalSupervisorChatInspection(
        await authority.rpcAfterAttach<unknown>(session, "thread/turns/list", {
          cursor: null,
          itemsView: "full",
          limit: 1,
          sortDirection: "desc",
          threadId: target.threadId,
        }),
        target,
      );
    },
    async interruptChat(target) {
      const session = requireLiveTarget(authority, target);
      const current = projectGlobalSupervisorChatInspection(
        await authority.rpcAfterAttach<unknown>(session, "thread/turns/list", {
          cursor: null,
          itemsView: "full",
          limit: 1,
          sortDirection: "desc",
          threadId: target.threadId,
        }),
        target,
      );
      if (current.turn?.status !== "inProgress") {
        return { status: "alreadyIdle", target, turnId: null };
      }
      try {
        await authority.rpcAfterAttach(session, "turn/interrupt", {
          threadId: target.threadId,
          turnId: current.turn.id,
        });
      } catch (error) {
        const latest = await authority.rpcAfterAttach<unknown>(session, "thread/turns/list", {
          cursor: null,
          itemsView: "full",
          limit: 1,
          sortDirection: "desc",
          threadId: target.threadId,
        });
        if (projectGlobalSupervisorChatInspection(latest, target).turn?.status !== "inProgress") {
          return { status: "alreadyIdle", target, turnId: null };
        }
        throw error;
      }
      return { status: "interruptRequested", target, turnId: current.turn.id };
    },
    async listActiveWork(supervisor) {
      const availableConnectionIds = new Set(
        authority
          .currentConnections()
          .filter((connection) => connection.enabled && authority.isRpcAvailable(connection.id))
          .map((connection) => connection.id),
      );
      const rows = await authority.readWorkCatalog();
      const pendingByThread = new Map<string, GlobalSupervisorPendingRequestSummary[]>();
      for (const request of authority.currentPendingRequests()) {
        const target = requestTarget(request);
        const projected = projectGlobalSupervisorPendingRequest(request);
        if (
          target === null ||
          projected === null ||
          !availableConnectionIds.has(target.connectionId)
        ) {
          continue;
        }
        const key = qualifiedKey(target);
        const existing = pendingByThread.get(key);
        if (existing === undefined) {
          pendingByThread.set(key, [projected]);
        } else {
          existing.push(projected);
        }
      }
      const spokenAttentionByThread = new Map<
        string,
        Awaited<ReturnType<GlobalSupervisorAttentionOwner["spokenAttention"]>>
      >();
      await Promise.all(
        rows.map(async (row) => {
          const target = globalSupervisorQualifiedChatRef(row.connectionId, row.remoteThreadId);
          spokenAttentionByThread.set(
            qualifiedKey(target),
            await authority.attention.spokenAttention(supervisor, target),
          );
        }),
      );
      return projectGlobalSupervisorActiveWork({
        availableConnectionIds,
        hiddenSupervisor: supervisor,
        pendingByThread,
        rows,
        spokenAttentionByThread,
      });
    },
    async listChatAttachments(target) {
      const session = requireLiveTarget(authority, target);
      return projectGlobalSupervisorChatAttachments(
        await authority.rpcAfterAttach<unknown>(session, "companion/threadAttachments/read", {
          threadId: target.threadId,
        }),
        target,
      );
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
    async readChatAttachment(request) {
      const session = requireLiveTarget(authority, request.target);
      const response = await authority.rpcAfterAttach<unknown>(
        session,
        "companion/threadAttachments/read",
        { threadId: request.target.threadId },
      );
      const attachment = resolveGlobalSupervisorChatAttachment(
        response,
        request.target,
        request.attachmentId,
      );
      if (attachment === null) {
        throw new Error("The selected chat attachment is no longer available");
      }
      return readGlobalSupervisorChatAttachmentText({
        attachment,
        offset: request.offset,
        readText: authority.readAttachmentText,
        target: request.target,
      });
    },
    respond: authority.respond,
    async respondToRequest(request) {
      requireLiveTarget(authority, request.target);
      const pending = authority.currentPendingRequests().find((candidate) => {
        const target = requestTarget(candidate);
        return (
          target !== null &&
          target.connectionId === request.target.connectionId &&
          target.threadId === request.target.threadId &&
          globalSupervisorPendingRequestEventId(candidate) === request.eventId
        );
      });
      if (pending === undefined) {
        throw new Error("The exact pending request is no longer available");
      }
      const result = globalSupervisorPendingRequestResult(pending, request.answer);
      await authority.respondToPendingRequest(pending, result);
      return { eventId: request.eventId, responded: true };
    },
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
    async setSpokenAttention(request) {
      let policy: GlobalSupervisorSpokenAttentionPolicy;
      if (request.mode === "snoozed") {
        if (request.durationMinutes === null) {
          throw new Error("Snoozed attention requires a duration");
        }
        policy = {
          mode: "snoozed" as const,
          until: authority.now() + request.durationMinutes * MILLISECONDS_PER_MINUTE,
        };
      } else {
        policy = { mode: request.mode };
      }
      await authority.attention.setSpokenAttention(request.supervisor, request.target, policy);
      return policy;
    },
    async startTask(request) {
      const capturedSession = requireLiveConnection(authority, request.connectionId);
      const worker = await createOrRecoverWorkerChat(authority, capturedSession, request);
      await authority.attention.completeWorkerCreation({ source: request.source, worker });
      await authority.attention.follow(request.supervisor, worker);
      if (
        authority.getSession(request.connectionId) !== capturedSession ||
        !authority.isRpcAvailable(request.connectionId)
      ) {
        throw new Error("The target chat authority changed before initial delivery");
      }
      const commandId = await authority.sendSystemText({
        commandId: request.commandId,
        connectionId: worker.connectionId,
        text: request.objective,
        threadId: worker.threadId,
      });
      return { chat: worker, commandId, delivery: "durablyQueued" };
    },
    async unfollowChat(supervisor, target) {
      await authority.attention.unfollow(supervisor, target);
    },
  };
}
