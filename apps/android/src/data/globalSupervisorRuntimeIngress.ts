import type { SyncEvent } from "@codewide/sync-client";
import type { NativeLiveRealtimeEvent } from "../native/native-engine-contract";

type Subscription = { readonly unsubscribe: () => void };

/** In-memory live-event fan-out consumed only by active Global Voice sessions. */
export type GlobalSupervisorRuntimeIngress = {
  readonly publishLive: (connectionId: string, event: NativeLiveRealtimeEvent) => void;
  readonly publishThreadEvents: (connectionId: string, events: readonly SyncEvent[]) => void;
  readonly subscribeLive: (
    listener: (connectionId: string, event: NativeLiveRealtimeEvent) => void,
  ) => Subscription;
  readonly subscribeThreadEvents: (
    listener: (connectionId: string, events: readonly SyncEvent[]) => void,
  ) => Subscription;
};

/** Process-local fan-out for live-only realtime notifications and non-replayed source events. */
export function createGlobalSupervisorRuntimeIngress(): GlobalSupervisorRuntimeIngress {
  const liveListeners = new Set<(connectionId: string, event: NativeLiveRealtimeEvent) => void>();
  const threadListeners = new Set<(connectionId: string, events: readonly SyncEvent[]) => void>();
  return {
    publishLive(connectionId: string, event: NativeLiveRealtimeEvent): void {
      for (const listener of liveListeners) {
        listener(connectionId, event);
      }
    },
    publishThreadEvents(connectionId: string, events: readonly SyncEvent[]): void {
      for (const listener of threadListeners) {
        listener(connectionId, events);
      }
    },
    subscribeLive(
      listener: (connectionId: string, event: NativeLiveRealtimeEvent) => void,
    ): Subscription {
      liveListeners.add(listener);
      return {
        unsubscribe() {
          liveListeners.delete(listener);
        },
      };
    },
    subscribeThreadEvents(
      listener: (connectionId: string, events: readonly SyncEvent[]) => void,
    ): Subscription {
      threadListeners.add(listener);
      return {
        unsubscribe() {
          threadListeners.delete(listener);
        },
      };
    },
  };
}
