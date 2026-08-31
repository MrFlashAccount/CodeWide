import { randomUUID } from "expo-crypto";

import { V2Runtime } from "./application/v2Runtime";
import { savedServerId } from "./domain/ids";
import { createNativeSyncV2OperationStore } from "./infrastructure/persistence/sqliteOperationStore";
import { createNativeSyncV2ProjectionStore } from "./infrastructure/persistence/sqliteProjectionStore";
import { createNativeSyncV2SavedServerDeletionStore } from "./infrastructure/persistence/sqliteSavedServerDeletionStore";
import { createSavedServerRepository } from "./infrastructure/persistence/sqliteSavedServerRepository";
import { SyncSessionRegistry } from "./infrastructure/sync/syncSessionRegistry";
import { createSyncSession } from "./infrastructure/sync/createSyncSession";
import { createClosedTerminalTransport } from "./infrastructure/terminal/closedTerminalTransport";
import { createClosedPortTransport } from "./infrastructure/ports/closedPortTransport";
import { createCommandCorrelationStore } from "./infrastructure/persistence/sqliteCommandCorrelationStore";
import { createNativeVoiceTransport } from "./infrastructure/voice/nativeVoiceTransport";

export function createV2Runtime(): V2Runtime {
  const operationStore = createNativeSyncV2OperationStore();
  const projectionStore = createNativeSyncV2ProjectionStore();
  const sessions = new SyncSessionRegistry(projectionStore, operationStore, createSyncSession);
  return new V2Runtime({
    correlationId: () => `correlation-${randomUUID()}`,
    correlations: createCommandCorrelationStore(),
    deletions: createNativeSyncV2SavedServerDeletionStore(),
    now: Date.now,
    operationId: () => `operation-${randomUUID()}`,
    operations: operationStore,
    portTransport: createClosedPortTransport(),
    projections: projectionStore,
    repository: createSavedServerRepository(),
    savedServerId: () => savedServerId(`saved-server-${randomUUID()}`),
    sessions,
    terminalTransport: createClosedTerminalTransport(() => `terminal-${randomUUID()}`),
    voiceTransport: createNativeVoiceTransport(() => `voice-${randomUUID()}`),
  });
}
