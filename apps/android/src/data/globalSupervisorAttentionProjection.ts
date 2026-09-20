import type { ThreadProjectionStore } from "./thread-projection-store";
import type { GlobalSupervisorAttentionOwner } from "./globalSupervisorAttention";

/** Adds the durable supervisor inbox to the existing ordered journal checkpoint. */
export function createGlobalSupervisorAttentionProjection(
  projection: ThreadProjectionStore,
  attention: GlobalSupervisorAttentionOwner,
): ThreadProjectionStore {
  return {
    async applyEvents(connectionId, events) {
      const projected = await projection.applyEvents(connectionId, events);
      await attention.ingestEvents(connectionId, events);
      return {
        checkpoint: Promise.all([projected.checkpoint]).then(() => undefined),
        threads: projected.threads,
      };
    },
    async applySnapshot(connectionId, snapshots, cursor) {
      await projection.applySnapshot(connectionId, snapshots, cursor);
      await attention.ingestSnapshot(connectionId, snapshots);
    },
  };
}
