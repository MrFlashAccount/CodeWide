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
import { createTerminalLifecycle } from "./infrastructure/terminal/terminalLifecycle";
import { createClosedPortTransport } from "./infrastructure/ports/closedPortTransport";
import { createCommandCorrelationStore } from "./infrastructure/persistence/sqliteCommandCorrelationStore";
import { createNativeVoiceTransport } from "./infrastructure/voice/nativeVoiceTransport";
import { createClosedPreviewTransport } from "./infrastructure/preview/closedPreviewTransport";
import { createThreadPinStore } from "./infrastructure/persistence/sqliteThreadPinStore";
import { createClosedComposerAttachmentTransport } from "./infrastructure/attachments/closedComposerAttachmentTransport";
import { createComposerDraftStore } from "./infrastructure/persistence/sqliteComposerDraftStore";
import { createTerminalSessionStore } from "./infrastructure/persistence/sqliteTerminalSessionStore";
import { createDocumentViewerPreferenceStore } from "./infrastructure/persistence/sqliteDocumentViewerPreferenceStore";

export function createV2Runtime(): V2Runtime {
  const operationStore = createNativeSyncV2OperationStore();
  const projectionStore = createNativeSyncV2ProjectionStore();
  const sessions = new SyncSessionRegistry(projectionStore, operationStore, createSyncSession);
  return new V2Runtime({
    attachmentTransport: createClosedComposerAttachmentTransport(),
    composerDrafts: createComposerDraftStore(),
    correlationId: () => `correlation-${randomUUID()}`,
    correlations: createCommandCorrelationStore(),
    deletions: createNativeSyncV2SavedServerDeletionStore(),
    documentViewerPreferences: createDocumentViewerPreferenceStore(),
    now: Date.now,
    operationId: () => `operation-${randomUUID()}`,
    operations: operationStore,
    portTransport: createClosedPortTransport(),
    previewTransport: createClosedPreviewTransport(),
    projections: projectionStore,
    repository: createSavedServerRepository(),
    savedServerId: () => savedServerId(`saved-server-${randomUUID()}`),
    sessions,
    terminalTransport: createClosedTerminalTransport(() => `terminal-${randomUUID()}`),
    terminalLifecycle: createTerminalLifecycle(),
    terminalSessions: createTerminalSessionStore(),
    threadPins: createThreadPinStore(),
    voiceTransport: createNativeVoiceTransport(() => `voice-${randomUUID()}`),
  });
}
