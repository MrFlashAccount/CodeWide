import { RpcResponseError, type RemoteConnection, type RpcClient } from "@codewide/sync-client";
import type { StoredConnection } from "./connection-profile-types";
import { recordTelemetryEvent } from "./telemetry";

/** Existing profile, native mint and identifier authorities supplied by module startup. */
export type WorkspaceSessionAuthority = {
  projectConnections(): StoredConnection[];
  mintNativeSession(connectionId: string): Promise<{ sessionToken: string; expiresAt: number }>;
  randomUUID(): string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** One credential cache and pending-mint owner for the existing JS singleton. */
export function createWorkspaceSession({
  projectConnections,
  mintNativeSession,
  randomUUID,
}: WorkspaceSessionAuthority) {
  const httpSessions = new Map<
    string,
    { credentialKey: string; sessionToken: string; expiresAt: number }
  >();
  const httpSessionMintInFlight = new Map<
    string,
    { credentialKey: string; promise: Promise<{ sessionToken: string; expiresAt: number }> }
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
    if (forceRefresh) httpSessions.delete(connection.id);
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
    if (connectionId === undefined) return await session.rpc<T>(method, params);
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
        values: { durationMs: performance.now() - startedAt },
        tags: { method, phase: "completed" },
      });
      return result;
    } catch (cause) {
      recordTelemetryEvent(connectionId, {
        name: "rpc.lifecycle",
        requestId,
        ...(threadId === undefined ? {} : { sessionId: threadId, threadId }),
        values: {
          durationMs: performance.now() - startedAt,
          ...(cause instanceof RpcResponseError ? { errorCode: cause.code } : {}),
        },
        tags: {
          method,
          phase: "failed",
          errorKind: cause instanceof RpcResponseError ? "rpc" : "transport",
        },
      });
      throw cause;
    }
  }

  return { currentConnections, scopedHttpAuthorization, forgetHttpAuthorization, rpcAfterAttach };
}

export type WorkspaceSyncSession = RpcClient & {
  stop(): void;
  respondToServerRequest?(id: string | number, result: unknown): Promise<void>;
};

export type WorkspaceSyncSupervisor = {
  replaceConnections(connections: RemoteConnection[]): void;
  session(connectionId: string): WorkspaceSyncSession | undefined;
  reattachRuntime(connectionId: string): Promise<void>;
  stop(): void;
};
