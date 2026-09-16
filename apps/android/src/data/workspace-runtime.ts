import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { Platform } from "react-native";
import { appLogger } from "../observability/logger";
import { NativeEngineSupervisor } from "../native/native-engine";
import {
  enqueueNativeCommand,
  listNativeCommands,
  mintNativeSession,
  nativeCompanionHttpOrigin,
} from "../native/native-transport";
import { assertSecureCryptoRuntime } from "../polyfills/secure-crypto";
import {
  createAccountRateLimitsDatabase,
  type AccountRateLimitsDatabase,
} from "./account-rate-limits-database";
import { createAccountRateLimitsLoader } from "./account-rate-limits-loader";
import { createCatalogRuntime } from "./catalog-runtime";
import { createCommandDelivery, createCommandDeliveryProjection } from "./command-delivery";
import {
  createConnectionProfileDatabase,
  type ConnectionProfileDatabase,
} from "./connection-profile-database";
import { connectionStateSeed, migrateConnectionProfiles } from "./connection-runtime";
import { createConnectionStateModel, type ConnectionStateModel } from "./connection-state-model";
import { FileTransferController } from "./file-transfer-controller";
import {
  createPendingRequestDatabase,
  type PendingRequestDatabase,
} from "./pending-request-database";
import { createPrivateTransferAccess } from "./private-transfer";
import { configureTelemetryAppVersion, configureTelemetryTransport } from "./telemetry";
import { createThreadDetailDatabase, type ThreadDetailDatabase } from "./thread-detail-database";
import { createThreadResourceLoader } from "./thread-resource-loader";
import { createThreadSummaryDatabase, type ThreadSummaryDatabase } from "./thread-summary-database";
import { createThreadSyncProjection } from "./thread-sync-projection";
import { createThreadSyncReconnect } from "./thread-sync-reconnect";
import { createThreadSyncRemoteLoader } from "./thread-sync-remote-loader";
import { createThreadSyncRuntime } from "./thread-sync-runtime";
import {
  createThreadUiStateDatabase,
  type ThreadUiStateDatabase,
} from "./thread-ui-state-database";
import { createTurnControlsLoader } from "./turn-controls-loader";
import { VoiceInputController } from "./voice-input-controller";
import { createVoiceTransport } from "./voice-transport";
import {
  createWorkspaceResourceDatabase,
  type WorkspaceResourceDatabase,
} from "./workspace-resource-database";
import type { WorkspaceSyncSupervisor } from "./workspace-session";
import { createWorkspaceSession } from "./workspace-session";
import { createWorkspaceTelemetryUpload } from "./workspace-telemetry";

export type WorkspaceRuntimeSnapshot = {
  accountRateLimits: AccountRateLimitsDatabase | null;
  connectionProfiles: ConnectionProfileDatabase | null;
  connectionState: ConnectionStateModel | null;
  error: string | null;
  pendingRequests: PendingRequestDatabase | null;
  ready: boolean;
  resources: WorkspaceResourceDatabase | null;
  threadDetails: ThreadDetailDatabase | null;
  threadSummaries: ThreadSummaryDatabase | null;
  threadUiState: ThreadUiStateDatabase | null;
};

class WorkspaceRuntime {
  readonly native = Platform.OS === "android";
  snapshot: WorkspaceRuntimeSnapshot = {
    accountRateLimits: null,
    connectionProfiles: null,
    connectionState: null,
    error: null,
    pendingRequests: null,
    ready: !this.native,
    resources: null,
    threadDetails: null,
    threadSummaries: null,
    threadUiState: null,
  };
  readonly listeners = new Set<() => void>();
  supervisor: WorkspaceSyncSupervisor | null = null;
  voiceController: VoiceInputController | null = null;
  fileTransferController: FileTransferController | null = null;
  startPromise: Promise<void> | null = null;
  profileSubscription: { unsubscribe: () => void } | null = null;
  connectionStateSubscription: { unsubscribe: () => void } | null = null;

  get resourceDatabase(): WorkspaceResourceDatabase {
    const database = this.snapshot.resources;
    if (database === null) {
      throw new Error("Workspace resources are not ready");
    }
    return database;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): WorkspaceRuntimeSnapshot => this.snapshot;

  update(patch: Partial<WorkspaceRuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  enabledConnectionIds(): string[] {
    return (
      this.snapshot.connectionProfiles?.collection.toArray
        .filter((row) => row.enabled)
        .map((row) => row.id) ?? []
    );
  }
}

async function ensureWorkspaceRuntimeStarted(): Promise<void> {
  if (!workspaceRuntime.native) {
    return;
  }
  if (workspaceRuntime.startPromise !== null) {
    return workspaceRuntime.startPromise;
  }
  workspaceRuntime.startPromise = startWorkspaceRuntime().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown startup error";
    workspaceRuntime.update({ error: message, ready: true });
    workspaceRuntime.startPromise = null;
  });
  return workspaceRuntime.startPromise;
}

async function startWorkspaceRuntime(): Promise<void> {
  let startupStage = "secure runtime";
  let createdThreadDetails: ThreadDetailDatabase | null = null;
  try {
    assertSecureCryptoRuntime();
    startupStage = "local database";
    const profiles = createConnectionProfileDatabase();
    const connectionState = createConnectionStateModel();
    const summaries = createThreadSummaryDatabase();
    const details = createThreadDetailDatabase();
    details.setRemoteLoader(createThreadSyncRemoteLoader(details, workspaceThreadSync));
    createdThreadDetails = details;
    const pendingRequests = createPendingRequestDatabase();
    const threadUiState = createThreadUiStateDatabase();
    const resources = createWorkspaceResourceDatabase();
    const accountRateLimits = createAccountRateLimitsDatabase();
    workspaceRuntime.voiceController = new VoiceInputController(resources);
    workspaceRuntime.fileTransferController = new FileTransferController(resources);
    // Publish the local-first stores before hydration, migrations and the
    // connection engine finish. The workspace can paint immediately while
    // its reactive stores fill from disk in the background.
    workspaceRuntime.update({
      accountRateLimits,
      connectionProfiles: profiles,
      connectionState,
      error: null,
      pendingRequests,
      ready: false,
      resources,
      threadDetails: details,
      threadSummaries: summaries,
      threadUiState,
    });
    summaries.setRenameHandler(async (connectionId, threadId, name) => {
      await enqueueNativeCommand(connectionId, `thread-name-${randomUUID()}`, "thread/name/set", {
        name,
        threadId,
      });
    });
    await Promise.all([
      summaries.prepare(),
      details.prepare(),
      profiles.collection.preload(),
      pendingRequests.collection.preload(),
      threadUiState.ready,
      resources.turnControls.preload(),
      accountRateLimits.collection.preload(),
    ]);
    // Kotlin owns the only durable command ledger. The UI cache is a reconstructable
    // read model, so startup reads the native snapshot only for state that is
    // already active (thread deletion) and never persists a second outbox copy.
    try {
      await summaries.reconcileDeleteCommands(await listNativeCommands());
    } catch (error) {
      appLogger.warnCaught({ error, event: "workspace.native_command.reconcile.failed" });
    }

    startupStage = "profile migration";
    const initialProfiles = await migrateConnectionProfiles(profiles, () => {
      startupStage = "native credential projection";
    });

    startupStage = "connection engine";
    const nativeSupervisorOptions: ConstructorParameters<typeof NativeEngineSupervisor>[0] = {
      connectionState: {
        setConnectionState(connectionId, state, diagnostic, rpcAvailable) {
          connectionState.setState(connectionId, state, diagnostic, rpcAvailable);
        },
      },
      onOutboxChange: createCommandDeliveryProjection(details, summaries),
      onPendingRequests: (connectionId, requests) => {
        pendingRequests.replace(connectionId, requests);
      },
      projection: createThreadSyncProjection({
        accountRateLimits,
        catalog: workspaceCatalog,
        details,
        resources,
        summaries,
        sync: workspaceThreadSync,
      }),
    };
    const supervisor: WorkspaceSyncSupervisor = new NativeEngineSupervisor(nativeSupervisorOptions);
    workspaceRuntime.supervisor = supervisor;
    workspaceCatalog.bindSummaryDemand(summaries);
    connectionState.reconcileProfiles(
      initialProfiles.map((connection) => ({
        connectionId: connection.id,
        enabled: connection.enabled,
        id: connection.id,
      })),
    );
    supervisor.replaceConnections(initialProfiles);
    workspaceRuntime.profileSubscription?.unsubscribe();
    workspaceRuntime.profileSubscription = profiles.collection.subscribeChanges(() => {
      const currentProfiles = profiles.project();
      connectionState.reconcileProfiles(currentProfiles.map(connectionStateSeed));
      supervisor.replaceConnections(currentProfiles);
    });
    workspaceRuntime.connectionStateSubscription?.unsubscribe();
    workspaceRuntime.connectionStateSubscription = connectionState.subscribeChanges(
      createThreadSyncReconnect({
        accountRateLimits,
        catalog: workspaceCatalog,
        details,
        refreshAccountRateLimits,
        sync: workspaceThreadSync,
      }),
      { includeInitialState: true },
    );
    workspaceRuntime.update({
      accountRateLimits,
      connectionProfiles: profiles,
      connectionState,
      error: null,
      pendingRequests,
      ready: true,
      resources,
      threadDetails: details,
      threadSummaries: summaries,
      threadUiState,
    });
    workspaceCatalog.registerLifecycle(workspaceThreadSync.bindForegroundRepair(supervisor));
  } catch (error) {
    if (createdThreadDetails !== null) {
      if (workspaceRuntime.snapshot.threadDetails === createdThreadDetails) {
        workspaceRuntime.update({ threadDetails: null });
      }
      try {
        await createdThreadDetails.close();
      } catch (error) {
        appLogger.warnCaught({ error: error, event: "workspace.thread_detail.close_failed" });
      }
    }
    const message = error instanceof Error ? error.message : "unknown startup error";
    throw new Error(`Local runtime startup failed (${startupStage}): ${message}`, { cause: error });
  }
}

const workspaceRuntime = new WorkspaceRuntime();
const { currentConnections, forgetHttpAuthorization, rpcAfterAttach, scopedHttpAuthorization } =
  createWorkspaceSession({
    mintNativeSession,
    projectConnections: () => workspaceRuntime.snapshot.connectionProfiles?.project() ?? [],
    randomUUID,
  });

const uploadTelemetryBatch = createWorkspaceTelemetryUpload({
  currentConnections,
  isRpcAvailable: (connectionId) =>
    workspaceRuntime.snapshot.connectionState?.rows$
      .peek()
      .find((candidate) => candidate.connectionId === connectionId)?.rpcAvailable === true,
  nativeCompanionHttpOrigin,
  scopedHttpAuthorization,
});
configureTelemetryTransport(uploadTelemetryBatch);
configureTelemetryAppVersion(Constants.expoConfig?.version);
const workspaceThreadSync = createThreadSyncRuntime({
  clearInvalidationArchived: (key) => {
    workspaceCatalog.clearInvalidationArchived(key);
  },
  getDetails: () => workspaceRuntime.snapshot.threadDetails,
  getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
  getSummaries: () => workspaceRuntime.snapshot.threadSummaries,
  loadTurnControls: async (connectionId, cwd) => loadTurnControls(connectionId, cwd),
  readInvalidationArchived: (key) => workspaceCatalog.readInvalidationArchived(key),
  refreshSubagents: async (connectionId, threadId) =>
    workspaceCatalog.refreshSubagents(connectionId, threadId),
  refreshThreadCatalog: async (connectionId, force) =>
    workspaceCatalog.refreshThreadCatalog(connectionId, force),
  rpcAfterAttach,
  transferAccess: async (connectionId, forceRefresh) => transferAccess(connectionId, forceRefresh),
});

const workspaceCatalog = createCatalogRuntime({
  desiredThreadId: (connectionId) => workspaceThreadSync.desiredThreadId(connectionId),
  enabledConnectionIds: () => workspaceRuntime.enabledConnectionIds(),
  getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
  getSummaries: () => workspaceRuntime.snapshot.threadSummaries,
  readThread: async (connectionId, threadId, cached, authoritative, repairShortWindow) =>
    workspaceThreadSync.readThread(
      connectionId,
      threadId,
      cached,
      authoritative,
      repairShortWindow,
    ),
});

// Runtime startup belongs to the application module, not to the lifetime of a
// React screen. Android keeps the native connection service alive while the
// UI observes the resulting local-first collections.

const retryStartup = async (): Promise<void> => {
  if (!workspaceRuntime.native || workspaceRuntime.snapshot.error === null) {
    return;
  }
  workspaceRuntime.startPromise = null;
  workspaceRuntime.update({ error: null, ready: false });
  await ensureWorkspaceRuntimeStarted();
};

const startVoiceTranscription = createVoiceTransport({
  getEnabledSession(connectionId) {
    const connection = currentConnections().find((candidate) => candidate.id === connectionId);
    if (connection === undefined || !connection.enabled) {
      return undefined;
    }
    return workspaceRuntime.supervisor?.session(connectionId);
  },
  rpcAfterAttach,
});

const loadTurnControls = createTurnControlsLoader({
  getResources: () => workspaceRuntime.snapshot.resources,
  getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
  rpcAfterAttach,
});

const refreshAccountRateLimits = createAccountRateLimitsLoader({
  getDatabase: () => workspaceRuntime.snapshot.accountRateLimits,
  getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
  rpcAfterAttach,
});

const transferAccess = createPrivateTransferAccess({
  currentConnections,
  nativeCompanionHttpOrigin,
  scopedHttpAuthorization,
});

export {
  currentConnections,
  forgetHttpAuthorization,
  loadTurnControls,
  refreshAccountRateLimits,
  retryStartup,
  rpcAfterAttach,
  scopedHttpAuthorization,
  startVoiceTranscription,
  transferAccess,
  workspaceCatalog,
  workspaceRuntime,
  workspaceThreadSync,
};
export const commandDelivery = createCommandDelivery(
  () => workspaceRuntime.snapshot.threadDetails,
  randomUUID,
);
export const workspaceThreadResources = createThreadResourceLoader({
  getResources: () => workspaceRuntime.resourceDatabase,
  getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
  readRecencyAt: async (connectionId, threadId) =>
    (await workspaceRuntime.snapshot.threadSummaries?.get(connectionId, threadId))?.recencyAt ??
    null,
  rpcAfterAttach,
});
function startWorkspaceRuntimeInBackground(): void {
  ensureWorkspaceRuntimeStarted().catch((error: unknown) => {
    workspaceRuntime.update({
      error: error instanceof Error ? error.message : "unknown startup error",
      ready: true,
    });
  });
}
startWorkspaceRuntimeInBackground();
