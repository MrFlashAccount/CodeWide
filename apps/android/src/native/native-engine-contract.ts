import type {
  RemoteConnectionState,
  SyncEvent,
  SyncServerRequest,
  SyncSnapshotThread,
} from "@codewide/sync-client";
import type { ThreadEventProjection } from "../data/thread-projection-store";
import type { NativeCommandDelivery } from "./native-transport-contract";

/** Durable projection operations required by the native engine supervisor. */
export type NativeDomainProjection = {
  applySnapshot(connectionId: string, threads: SyncSnapshotThread[], cursor: number): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<ThreadEventProjection>;
};

/** Publishes native connection state into the application model. */
export type NativeConnectionStateProjection = {
  setConnectionState(
    connectionId: string,
    state: RemoteConnectionState,
    diagnostic?: string | null,
    rpcAvailable?: boolean,
  ): void | Promise<void>;
};

/** Injected projections and observers used to construct the native engine supervisor. */
export type NativeEngineSupervisorOptions = {
  connectionState: NativeConnectionStateProjection;
  projection: NativeDomainProjection;
  onPendingRequests?(connectionId: string, requests: SyncServerRequest[]): void;
  onOutboxChange?(delivery: NativeCommandDelivery): void;
};
