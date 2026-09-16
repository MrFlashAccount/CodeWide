import { RpcResponseError, type RemoteConnection, type RpcClient } from "@codewide/sync-client";
import type { StoredConnection } from "./connection-profile-types";
import { recordTelemetryEvent } from "./telemetry";

/** Existing profile, native mint and identifier authorities supplied by module startup. */
export type WorkspaceSessionAuthority = {
  mintNativeSession: (connectionId: string) => Promise<{ expiresAt: number; sessionToken: string }>;
  projectConnections: () => StoredConnection[];
  randomUUID: () => string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** One credential cache and pending-mint owner for the existing JS singleton. */
export function createWorkspaceSession({
  mintNativeSession,
  projectConnections,
  randomUUID,
}: WorkspaceSessionAuthority) {
  const httpSessions = new Map<
    string,
    { credentialKey: string; expiresAt: number; sessionToken: string }
  >();
  const httpSessionMintInFlight = new Map<
    string,
    { credentialKey: string; promise: Promise<{ expiresAt: number; sessionToken: string }> }
  >();

  function currentConnections(): StoredConnection[] {
    return projectConnections();
  }

  function forgetHttpAuthorization(connectionId: string): void {
    httpSessions.delete(connectionId);
  }

  async function scopedHttpAuthorization(
    connection: StoredConnection,
    forceRefresh = false,
  ): Promise<string> {
    const cached = httpSessions.get(connection.id);
    const credentialKey = `${connection.endpoint}\u0000${connection.tlsPinSha256 ?? ""}`;
    if (
      !forceRefresh &&
      cached !== undefined &&
      cached.credentialKey === credentialKey &&
      cached.expiresAt > Date.now() + 30_000
    ) {
      return `Bearer ${cached.sessionToken}`;
    }
    const existingMint = httpSessionMintInFlight.get(connection.id);
    if (
      !forceRefresh &&
      existingMint !== undefined &&
      existingMint.credentialKey === credentialKey
    ) {
      return `Bearer ${(await existingMint.promise).sessionToken}`;
    }
    if (forceRefresh) {
      httpSessions.delete(connection.id);
    }
    const promise = mintNativeSession(connection.id);
    const pending = { credentialKey, promise };
    httpSessionMintInFlight.set(connection.id, pending);
    try {
      const minted = await promise;
      httpSessions.set(connection.id, { credentialKey, ...minted });
      return `Bearer ${minted.sessionToken}`;
    } finally {
      if (httpSessionMintInFlight.get(connection.id) === pending) {
        httpSessionMintInFlight.delete(connection.id);
      }
    }
  }

  async function rpcAfterAttach<T>(
    session: RpcClient,
    method: string,
    params: unknown,
  ): Promise<T> {
    const connectionId = session.connectionId;
    if (connectionId === undefined) {
      return session.rpc<T>(method, params);
    }
    const paramsRecord = asRecord(params);
    const requestId =
      typeof paramsRecord?.requestId === "string" && paramsRecord.requestId.length > 0
        ? paramsRecord.requestId
        : `rpc-${randomUUID()}`;
    const threadId = typeof paramsRecord?.threadId === "string" ? paramsRecord.threadId : undefined;
    const startedAt = performance.now();
    recordTelemetryEvent(connectionId, {
      name: "rpc.lifecycle",
      requestId,
      ...(threadId === undefined ? {} : { sessionId: threadId, threadId }),
      tags: { method, phase: "started" },
    });
    try {
      const result = await session.rpc<T>(method, params);
      recordTelemetryEvent(connectionId, {
        name: "rpc.lifecycle",
        requestId,
        ...(threadId === undefined ? {} : { sessionId: threadId, threadId }),
        tags: { method, phase: "completed" },
        values: { durationMs: performance.now() - startedAt },
      });
      return result;
    } catch (error) {
      recordTelemetryEvent(connectionId, {
        name: "rpc.lifecycle",
        requestId,
        ...(threadId === undefined ? {} : { sessionId: threadId, threadId }),
        tags: {
          errorKind: error instanceof RpcResponseError ? "rpc" : "transport",
          method,
          phase: "failed",
        },
        values: {
          durationMs: performance.now() - startedAt,
          ...(error instanceof RpcResponseError ? { errorCode: error.code } : {}),
        },
      });
      throw error;
    }
  }

  return { currentConnections, forgetHttpAuthorization, rpcAfterAttach, scopedHttpAuthorization };
}

export type WorkspaceSyncSession = RpcClient & {
  respondToServerRequest?: (id: string | number, result: unknown) => Promise<void>;
  stop: () => void;
};

export type WorkspaceSyncSupervisor = {
  reattachRuntime: (connectionId: string) => Promise<void>;
  replaceConnections: (connections: RemoteConnection[]) => void;
  session: (connectionId: string) => WorkspaceSyncSession | undefined;
  stop: () => void;
};
