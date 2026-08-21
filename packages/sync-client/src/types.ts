import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

export type RemoteConnectionState =
  | "offline"
  | "connecting"
  | "syncing"
  | "live"
  | "degraded"
  | "authRequired";

export type RemoteConnection = {
  id: string;
  endpoint: string;
  token: string;
  tlsPinSha256?: string;
  enabled: boolean;
};

export type SyncEvent = {
  cursor: number;
  payload: Record<string, unknown>;
};

export type SyncEventIngress = {
  /** Monotonic JS timestamp captured before decoding the socket frame. */
  observedAtMs: number;
  /** Time spent converting and parsing the socket frame in JS. */
  decodeDurationMs: number;
  /** Native WebSocket callback to JS listener latency, when the transport exposes it. */
  nativeToJsMs?: number;
};

export type SocketMessageEvent = {
  data: unknown;
  /** Wall-clock timestamp captured by the native transport callback. */
  receivedAtUnixMs?: number;
};

export type SyncSnapshotThread = {
  thread: Thread;
  archived: boolean;
};

export type SyncServerRequest = {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
};

export interface SyncCache {
  getCursor(connectionId: string): Promise<number | null>;
  applySnapshot(connectionId: string, threads: SyncSnapshotThread[], cursor: number): Promise<void>;
  replacePendingServerRequests(connectionId: string, requests: SyncServerRequest[]): Promise<void>;
  applyEvent(connectionId: string, event: SyncEvent): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<void>;
  setConnectionState(connectionId: string, state: RemoteConnectionState, diagnostic?: string | null): Promise<void>;
}

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: SocketMessageEvent) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
}

export type SocketFactory = (connection: RemoteConnection) => SocketLike;
