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
  applyEvents: (connectionId: string, events: SyncEvent[]) => Promise<ThreadEventProjection>;
  applySnapshot: (
    connectionId: string,
    threads: SyncSnapshotThread[],
    cursor: number,
  ) => Promise<void>;
};

/** Publishes native connection state into the application model. */
export type NativeConnectionStateProjection = {
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  setConnectionState: (
    connectionId: string,
    state: RemoteConnectionState,
    diagnostic?: string | null,
    rpcAvailable?: boolean,
  ) => void | Promise<void>;
};

/** Injected projections and observers used to construct the native engine supervisor. */
export type NativeEngineSupervisorOptions = {
  connectionState: NativeConnectionStateProjection;
  onOutboxChange?: (delivery: NativeCommandDelivery) => void;
  onPendingRequests?: (connectionId: string, requests: SyncServerRequest[]) => void;
  projection: NativeDomainProjection;
};
