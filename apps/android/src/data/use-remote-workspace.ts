import type {
  AccountRateLimitsUpdatedNotification,
  ConfigReadResponse,
  FsReadDirectoryResponse,
  GetAccountRateLimitsResponse,
  ModelListResponse,
  PermissionProfileListResponse,
  ReviewDelivery,
  ReviewStartResponse,
  ReviewTarget,
  SkillsListResponse,
  Thread,
  ThreadBackgroundTerminalsListResponse,
  ThreadBackgroundTerminalsTerminateResponse,
  ThreadForkResponse,
  ThreadGoal,
  ThreadGoalGetResponse,
  ThreadGoalSetResponse,
  ThreadGoalStatus,
  ThreadItemsListResponse,
  ThreadReadResponse,
  ThreadStartResponse,
  ThreadTurnsListResponse,
  Turn,
} from "@codewide/codex-protocol/v0.147.0/v2";
import type { Personality } from "@codewide/codex-protocol/v0.147.0";
import { createTextOutboxCommand, MAX_TURN_TEXT_CHARS, RpcResponseError, seedThreadExecutionSettings, threadIdFromEvent, threadProjectionPatchFromEvent, type RemoteConnection, type RemoteConnectionState, type RemoteFileAttachment, type RpcClient } from "@codewide/sync-client";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@legendapp/state/react";
import { useSyncExternalStore } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";

import { validateConnectionInput, validateConnectionRuntimeUpdate, type ConnectionInput, type ConnectionUpdateInput } from "./connection-validation";
import { commitNativeThenProject } from "./durable-command-boundary";
import { operationConfirmsDeliveredCommand } from "./command-receipt-evidence";
import { accountRateLimitsStale } from "./account-rate-limits";
import type { AccountLoginStart, AccountPoolSnapshot } from "./account-pool";
import { createAccountRateLimitsDatabase, type AccountRateLimitsDatabase } from "./account-rate-limits-database";
import { createConnectionProfileDatabase, type ConnectionProfileDatabase } from "./connection-profile-database";
import type { StoredConnection } from "./connection-profile-types";
import { connectionDisplayState, createConnectionStateModel, type ConnectionStateModel } from "./connection-state-model";
import { createThreadDetailDatabase, type ThreadDetailDatabase } from "./thread-detail-database";
import type { PendingTimelineMutation } from "./thread-detail-projection";
import { projectThreadHotStates } from "./thread-hot-state";
import { createThreadUiStateDatabase, type ThreadUiStateDatabase } from "./thread-ui-state-database";
import { incrementMetric, recordTiming } from "./operational-metrics";
import { configureTelemetryAppVersion, configureTelemetryTransport, recordTelemetryEvent, type TelemetryBatch } from "./telemetry";
import { hasAppServerAcceptedPendingDelivery, hasUnresolvedDeliveredCommand, parseHostQueueSnapshot } from "./queue-event";
import { parseAddedRemoteProject, parseRemoteDirectory, parseRemoteProjects, type RemoteDirectoryEntry, type RemoteProject } from "./remote-projects";
import { parseCreatedWorkspace, parseWorkspaceSupport, startThreadInCreatedWorkspace, type CreatedWorkspace, type WorkspaceSupport } from "./workspace-creation";
import { queuedInputPayload } from "./queued-input";
import { createPendingRequestDatabase, type PendingRequestDatabase } from "./pending-request-database";
import type { PendingServerRequest } from "./pending-request-types";
import { RealtimeAudioUploader } from "./realtime-audio-uploader";
import { LegacyRemoteStore } from "./legacy-remote-store";
import { createThreadSummaryDatabase, type ThreadSummaryDatabase } from "./thread-summary-database";
import { createThreadProjectionStore } from "./thread-projection-store";
import { loadThreadCatalog } from "./thread-catalog-loader";
import { streamRepairThreadIds, terminalProjectionMatches, terminalProjectionProofs } from "./stream-recovery";
import {
  materializeAuthoritativeThreadWindow,
  materializeReadOnlyThreadWindow,
  materializeResumedThread,
  type CompanionThreadResumeResponse,
} from "./thread-read-model";
import { shouldRefreshInvalidatedThread } from "./thread-detail-invalidation";
import { collectThreadCursorDelta, latestSealedTurnId, planThreadOpenSync, shouldUseBoundedThreadWindowRead, threadOpenNeedsCursorCatchUp } from "./thread-cursor-sync";
import { recordThreadHistoryTelemetry, telemetryErrorKind } from "./thread-history-telemetry";
import { projectThreadResourcePatch } from "./thread-resource-projection";
import { loadSubagentDescendants, subagentActivityRootThreadId } from "./subagent-loader";
import type { StoredThreadSummary } from "./thread-summary-types";
import type { StoredComposerPreferences, StoredDraftAttachment } from "./thread-ui-state-types";
import { buildThreadForkParams, type ThreadForkOptions } from "./thread-fork";
import {
  THREAD_HISTORY_PAGE_SIZE,
  THREAD_RESIDENT_TURN_LIMIT,
  threadResumePageLimit,
} from "./thread-pagination";
import { cloneTurnControls, isTurnControlsCacheFresh, loadTurnControlsIncrementally } from "./turn-controls-loader";
import { createWorkspaceResourceDatabase, threadResourceKey, tunnelResourceKey, turnControlsResourceKey, type BackgroundTerminalValue, type ThreadChangeScope, type ThreadResourceKind, type ThreadResourcesValue, type TunnelValue, type TurnControlsValue, type WorkspaceResourceDatabase } from "./workspace-resource-database";
import { RetryableVoiceTranscriptionError, UnretryableVoiceTranscriptionError, VoiceInputController, type VoiceTranscriptionEvent, type VoiceTranscriptionOptions, type VoiceTranscriptionSession } from "./voice-input-controller";
import { FileTransferController } from "./file-transfer-controller";
import type { TransferAccess } from "./private-transfer";
import { assertSecureCryptoRuntime } from "../polyfills/secure-crypto";
import { NativeEngineSupervisor } from "../native/native-engine";
import { acknowledgeNativeCommandReceipt, claimNativePairing, deleteNativeConnection, enqueueNativeCommand, listNativeCommands, listNativeConnectionConfigs, mintNativeSession, nativeCompanionHttpOrigin, purgeLegacyDerivedStorage, reconnectNativeConnection, retryNativeCommand, saveNativeConnectionCredentials, setNativeConnectionEnabled, wakeNativeConnection, type NativeCommandDelivery } from "../native/native-transport";

export type RemoteWorkspace = {
  native: boolean;
  ready: boolean;
  error: string | null;
  connections: StoredConnection[];
  threadSummaryDatabase: ThreadSummaryDatabase | null;
  threadUiStateDatabase: ThreadUiStateDatabase | null;
  resourceDatabase: WorkspaceResourceDatabase | null;
  accountRateLimitsDatabase: AccountRateLimitsDatabase | null;
  voiceController: VoiceInputController | null;
  fileTransferController: FileTransferController | null;
  pendingRequests: PendingServerRequest[];
  threadDetails: ThreadDetailDatabase | null;
  retryStartup(): Promise<void>;
  addConnection(input: ConnectionInput): Promise<StoredConnection>;
  deleteConnection(connectionId: string): Promise<void>;
  setConnectionEnabled(connectionId: string, enabled: boolean): Promise<void>;
  reconnectConnection(connectionId: string): Promise<void>;
  updateConnectionProfile(connectionId: string, displayName: string, emoji: string): Promise<void>;
  updateConnection(connectionId: string, input: ConnectionUpdateInput): Promise<void>;
  moveConnection(connectionId: string, direction: -1 | 1): Promise<void>;
  searchThreads(query: string, connectionId?: string | null): Promise<StoredThreadSummary[]>;
  listProjects(connectionId: string): Promise<RemoteProject[]>;
  addProject(connectionId: string, path: string): Promise<RemoteProject>;
  readDirectory(connectionId: string, path: string): Promise<RemoteDirectoryEntry[]>;
  inspectWorkspace(connectionId: string, workspace: string): Promise<WorkspaceSupport | null>;
  createWorkspace(connectionId: string, workspace: string, requestId: string): Promise<CreatedWorkspace>;
  startThreadInWorkspace(connectionId: string, workspace: string, requestId: string): Promise<string>;
  setThreadPinned(connectionId: string, threadId: string, pinned: boolean): Promise<void>;
  startThread(connectionId: string, cwd?: string): Promise<string>;
  renameThread(connectionId: string, threadId: string, name: string): Promise<void>;
  archiveThread(connectionId: string, threadId: string): Promise<void>;
  unarchiveThread(connectionId: string, threadId: string): Promise<void>;
  deleteThread(connectionId: string, threadId: string): Promise<void>;
  markThreadRead(connectionId: string, threadId: string): Promise<void>;
  loadDraft(connectionId: string, threadId: string): Promise<string>;
  saveDraft(connectionId: string, threadId: string, text: string): Promise<void>;
  loadDraftAttachments(connectionId: string, threadId: string): Promise<StoredDraftAttachment[]>;
  saveDraftAttachments(connectionId: string, threadId: string, attachments: StoredDraftAttachment[]): Promise<void>;
  loadScrollOffset(connectionId: string, threadId: string): Promise<number | null>;
  saveScrollOffset(connectionId: string, threadId: string, offset: number, historyAnchorTurnId: string | null, historyAnchorOffsetPx: number | null): Promise<void>;
  loadComposerPreferences(connectionId: string, threadId: string): Promise<StoredComposerPreferences | null>;
  saveComposerPreferences(connectionId: string, threadId: string, preferences: StoredComposerPreferences): Promise<void>;
  listQueuedPrompts(connectionId: string, threadId: string): Promise<QueuedPrompt[]>;
  editQueuedPrompt(connectionId: string, commandId: string, text: string, attachments: RemoteFileAttachment[]): Promise<void>;
  cancelQueuedPrompt(connectionId: string, commandId: string): Promise<void>;
  moveQueuedPrompt(connectionId: string, threadId: string, commandId: string, direction: -1 | 1): Promise<void>;
  steerQueuedPrompt(connectionId: string, commandId: string, expectedTurnId: string): Promise<void>;
  listBackgroundTerminals(connectionId: string, threadId: string): Promise<BackgroundTerminal[]>;
  terminateBackgroundTerminal(connectionId: string, threadId: string, processId: string): Promise<boolean>;
  readThread(connectionId: string, threadId: string, cachedThread?: Thread | null, requireAuthoritative?: boolean, mutableHeadOnly?: boolean): Promise<ThreadWindow | null>;
  observeThread(connectionId: string, threadId: string, keepAcrossReconnect?: boolean): Promise<void>;
  refreshSubagents(connectionId: string, rootThreadId: string, force?: boolean): Promise<void>;
  loadThreadResources(connectionId: string, threadId: string, scope?: ThreadChangeScope, kind?: ThreadResourceLoadKind): Promise<ThreadResourcesValue>;
  loadThreadChangeDiff(connectionId: string, threadId: string, path: string, scope?: ThreadChangeScope): Promise<ThreadChangeDiffValue>;
  loadTurnItems(connectionId: string, threadId: string, turnId: string): Promise<Turn["items"]>;
  startVoiceTranscription(connectionId: string, threadId: string, listener: VoiceTranscriptionListener, options?: VoiceTranscriptionOptions): Promise<VoiceTranscriptionSession>;
  sendText(connectionId: string, threadId: string, text: string, mode?: SendMode, options?: TurnSendOptions): Promise<string>;
  retryFailedMessage(connectionId: string, commandId: string): Promise<void>;
  loadTurnControls(connectionId: string, cwd: string): Promise<TurnControls>;
  updateThreadSettings(connectionId: string, threadId: string, settings: ThreadSettings): Promise<void>;
  interruptTurn(connectionId: string, threadId: string, turnId: string): Promise<void>;
  forkThread(connectionId: string, threadId: string, options: ThreadForkOptions): Promise<string>;
  getThreadGoal(connectionId: string, threadId: string): Promise<ThreadGoal | null>;
  setThreadGoal(connectionId: string, threadId: string, input: ThreadGoalInput): Promise<ThreadGoal>;
  clearThreadGoal(connectionId: string, threadId: string): Promise<boolean>;
  startReview(connectionId: string, threadId: string, target: ReviewTarget, delivery: ReviewDelivery): Promise<string>;
  compactThread(connectionId: string, threadId: string): Promise<void>;
  refreshAccountRateLimits(connectionId: string, force?: boolean): Promise<GetAccountRateLimitsResponse>;
  refreshAccountPool(connectionId: string): Promise<AccountPoolSnapshot>;
  startAccountLogin(connectionId: string): Promise<AccountLoginStart>;
  cancelAccountLogin(connectionId: string, loginId: string): Promise<void>;
  activateAccountProfile(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
  updateAccountProfile(connectionId: string, profileId: string, update: { enabled?: boolean; priority?: number }): Promise<AccountPoolSnapshot>;
  removeAccountProfile(connectionId: string, profileId: string): Promise<AccountPoolSnapshot>;
  createLocalhostTunnel(connectionId: string, port: number, ttlSeconds: number): Promise<TunnelPreview>;
  revokeLocalhostTunnel(connectionId: string, tunnelId: string): Promise<void>;
  respondToServerRequest(request: PendingServerRequest, result: unknown): Promise<void>;
  transferAccess(connectionId: string, forceRefresh?: boolean): Promise<TransferAccess>;
};

export type SendMode = { type: "start" } | { type: "queue" } | { type: "steer"; expectedTurnId: string };
export type ThreadSettings = { model?: string | null; effort?: string | null; personality?: Personality | null; permissions?: string | null };
export type ThreadGoalInput = { objective: string; status: ThreadGoalStatus; tokenBudget: number | null };
export type TurnSendOptions = ThreadSettings & {
  skills?: Array<{ name: string; path: string }>;
  attachments?: RemoteFileAttachment[];
  workspaceRequestId?: string;
};
export type ComposerAttachment = StoredDraftAttachment;
export type TurnControls = TurnControlsValue;
export type TunnelPreview = TunnelValue;
export type { TransferAccess } from "./private-transfer";
export type ThreadWindow = { thread: Thread; nextCursor: string | null | undefined };
export type ThreadTurnPage = { turns: Turn[]; nextCursor: string | null; acceptedHistory: boolean; extendedHistory: boolean };
export type ThreadChangeDiffValue = {
  threadId: string;
  path: string;
  changeScope: ThreadChangeScope;
  patches: Array<{ turnId: string; itemId: string; kind: "add" | "delete" | "update"; diff: string }>;
  source: string | null;
  truncated: boolean;
};

type WorkspaceSyncSession = RpcClient & {
  stop(): void;
  respondToServerRequest?(id: string | number, result: unknown): Promise<void>;
};

type WorkspaceSyncSupervisor = {
  replaceConnections(connections: RemoteConnection[]): void;
  session(connectionId: string): WorkspaceSyncSession | undefined;
  stop(): void;
};
export type VoiceAudioChunk = { data: string; sampleRate: number; numChannels: number; samplesPerChannel: number };
export type { VoiceTranscriptionEvent, VoiceTranscriptionOptions, VoiceTranscriptionSession } from "./voice-input-controller";
export type VoiceTranscriptionListener = (event: VoiceTranscriptionEvent) => void;
export { RetryableVoiceTranscriptionError } from "./voice-input-controller";
export type QueuedPrompt = { commandId: string; text: string; attachments: RemoteFileAttachment[]; createdAt: number; state: "queued" | "uncertain" | "failed"; lastError: string | null };
export type BackgroundTerminal = BackgroundTerminalValue;
type WorkspaceProjectionKey =
  | "native"
  | "ready"
  | "error"
  | "connections"
  | "threads"
  | "subagents"
  | "threadSummaryDatabase"
  | "threadUiStateDatabase"
  | "resourceDatabase"
  | "accountRateLimitsDatabase"
  | "voiceController"
  | "fileTransferController"
  | "pendingRequests"
  | "threadDetails";
type WorkspaceActions = Omit<RemoteWorkspace, WorkspaceProjectionKey> & {
  refreshThreadCatalog(connectionId: string, force?: boolean): Promise<void>;
  repairThreadProjection(connectionId: string, threadId: string, indexedHeadOnly?: boolean): Promise<ThreadWindow | null>;
  loadOlderTurns(connectionId: string, threadId: string, cursor: string, expectedHistoryEpoch: number): Promise<ThreadTurnPage>;
};
const CONNECTION_PROFILE_MIGRATION_KEY = "codex-remote-connection-profiles-v1-migrated";
const CONNECTION_PROFILE_STORAGE_MIGRATION_KEY = "codex-remote-connection-profiles-cache-split-v1-migrated";
const NATIVE_CREDENTIAL_MIGRATION_KEY = "codex-remote-native-credentials-v1-migrated";
const THREAD_CATALOG_REPAIR_INTERVAL_MS = 10 * 60 * 1_000;
const THREAD_CATALOG_REPAIR_TICK_MS = 60 * 1_000;
const TURN_CONTROLS_FRESH_MS = 6 * 60 * 60 * 1_000;
const EMPTY_TURN_CONTROLS: TurnControls = {
  models: [],
  skills: [],
  permissions: [],
  defaults: { model: null, effort: null, permissions: null },
};

type WorkspaceRuntimeSnapshot = {
  ready: boolean;
  error: string | null;
  connectionProfiles: ConnectionProfileDatabase | null;
  connectionState: ConnectionStateModel | null;
  threadSummaries: ThreadSummaryDatabase | null;
  threadDetails: ThreadDetailDatabase | null;
  pendingRequests: PendingRequestDatabase | null;
  threadUiState: ThreadUiStateDatabase | null;
  resources: WorkspaceResourceDatabase | null;
  accountRateLimits: AccountRateLimitsDatabase | null;
};

class WorkspaceRuntime {
  readonly native = Platform.OS === "android";
  snapshot: WorkspaceRuntimeSnapshot = {
    ready: !this.native,
    error: null,
    connectionProfiles: null,
    connectionState: null,
    threadSummaries: null,
    threadDetails: null,
    pendingRequests: null,
    threadUiState: null,
    resources: null,
    accountRateLimits: null,
  };
  readonly listeners = new Set<() => void>();
  readonly threadUiStateSeedInFlight = new Map<string, ReturnType<ThreadUiStateDatabase["getOrCreate"]>>();
  readonly httpSessions = new Map<string, { credentialKey: string; sessionToken: string; expiresAt: number }>();
  readonly httpSessionMintInFlight = new Map<string, { credentialKey: string; promise: Promise<{ sessionToken: string; expiresAt: number }> }>();
  readonly threadReadInFlight = new Map<string, {
    authority: "local" | "mutable-head" | "recovery";
    promise: Promise<ThreadWindow | null>;
  }>();
  readonly threadObserverDesired = new Map<string, string>();
  readonly threadObserverAttachInFlight = new Map<string, Promise<void>>();
  readonly threadInvalidationGeneration = new Map<string, number>();
  readonly threadInvalidationRefreshInFlight = new Map<string, Promise<void>>();
  readonly threadInvalidationArchived = new Map<string, boolean>();
  readonly threadInvalidationActive = new Map<string, boolean>();
  readonly threadResourcesInFlight = new Map<string, Promise<ThreadResourcesValue>>();
  readonly threadCatalogRefreshInFlight = new Map<string, Promise<void>>();
  readonly threadCatalogRefreshedAt = new Map<string, number>();
  readonly subagentRefreshInFlight = new Map<string, Promise<void>>();
  readonly subagentRefreshedAt = new Map<string, number>();
  readonly turnItemsInFlight = new Map<string, Promise<Turn["items"]>>();
  readonly turnControlsInFlight = new Map<string, Promise<TurnControls>>();
  readonly accountRateLimitsInFlight = new Map<string, Promise<GetAccountRateLimitsResponse>>();
  readonly connectionAttemptStartedAt = new Map<string, number>();
  supervisor: WorkspaceSyncSupervisor | null = null;
  voiceController: VoiceInputController | null = null;
  fileTransferController: FileTransferController | null = null;
  startPromise: Promise<void> | null = null;
  profileSubscription: { unsubscribe(): void } | null = null;
  connectionStateSubscription: { unsubscribe(): void } | null = null;
  catalogRepairTimer: ReturnType<typeof setInterval> | null = null;
  catalogLifecycleSubscriptions: Array<{ remove(): void }> = [];

  get resourceDatabase(): WorkspaceResourceDatabase {
    const database = this.snapshot.resources;
    if (database === null) throw new Error("Workspace resources are not ready");
    return database;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): WorkspaceRuntimeSnapshot => this.snapshot;

  update(patch: Partial<WorkspaceRuntimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  enabledConnectionIds(): string[] {
    return this.snapshot.connectionProfiles?.collection.toArray
      .filter((row) => row.enabled)
      .map((row) => row.id) ?? [];
  }
}

const workspaceRuntime = new WorkspaceRuntime();

function currentConnections(): StoredConnection[] {
  return workspaceRuntime.snapshot.connectionProfiles?.project() ?? [];
}

configureTelemetryTransport(uploadTelemetryBatch);
configureTelemetryAppVersion(Constants.expoConfig?.version);

async function scopedHttpAuthorization(connection: StoredConnection, forceRefresh = false): Promise<string> {
  const cached = workspaceRuntime.httpSessions.get(connection.id);
  const credentialKey = `${connection.endpoint}\u0000${connection.tlsPinSha256 ?? ""}`;
  if (!forceRefresh && cached !== undefined && cached.credentialKey === credentialKey && cached.expiresAt > Date.now() + 30_000) {
    return `Bearer ${cached.sessionToken}`;
  }
  const existingMint = workspaceRuntime.httpSessionMintInFlight.get(connection.id);
  if (!forceRefresh && existingMint !== undefined && existingMint.credentialKey === credentialKey) {
    return `Bearer ${(await existingMint.promise).sessionToken}`;
  }
  if (forceRefresh) workspaceRuntime.httpSessions.delete(connection.id);
  const promise = mintNativeSession(connection.id);
  const pending = { credentialKey, promise };
  workspaceRuntime.httpSessionMintInFlight.set(connection.id, pending);
  try {
    const minted = await promise;
    workspaceRuntime.httpSessions.set(connection.id, { credentialKey, ...minted });
    return `Bearer ${minted.sessionToken}`;
  } finally {
    if (workspaceRuntime.httpSessionMintInFlight.get(connection.id) === pending) {
      workspaceRuntime.httpSessionMintInFlight.delete(connection.id);
    }
  }
}

async function uploadTelemetryBatch(connectionId: string, batch: TelemetryBatch): Promise<void> {
  const connection = currentConnections().find((candidate) => candidate.id === connectionId);
  if (connection === undefined || !connection.enabled) throw new Error("Telemetry connection is unavailable");
  const origin = await nativeCompanionHttpOrigin(connection.id, connection.endpoint);
  const send = async (forceRefresh: boolean) => await fetch(companionHttpUrl(origin, "/v1/telemetry/events"), {
    method: "POST",
    headers: {
      authorization: await scopedHttpAuthorization(connection, forceRefresh),
      "content-type": "application/json",
    },
    body: JSON.stringify(batch),
  });
  let response = await send(false);
  if (response.status === 401) response = await send(true);
  if (!response.ok) throw new Error(`Telemetry upload failed (${response.status})`);
}

// Runtime startup belongs to the application module, not to the lifetime of a
// React screen. Android keeps the native connection service alive while the
// UI observes the resulting local-first collections.
void ensureWorkspaceRuntimeStarted();

function createWorkspaceActions(): WorkspaceActions {
  const native = workspaceRuntime.native;
  const retryStartup = async (): Promise<void> => {
      if (!native || workspaceRuntime.snapshot.error === null) return;
      workspaceRuntime.startPromise = null;
      workspaceRuntime.update({ ready: false, error: null });
      await ensureWorkspaceRuntimeStarted();
    };
  
    const startVoiceTranscription = async (
      connectionId: string,
      _threadId: string,
      listener: VoiceTranscriptionListener,
      options: VoiceTranscriptionOptions = {},
    ): Promise<VoiceTranscriptionSession> => {
      const connection = currentConnections().find((candidate) => candidate.id === connectionId);
      if (connection === undefined || !connection.enabled) throw new Error("Connection is not enabled");
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const voiceStartAt = performance.now();
      let start: unknown;
      try {
        start = await rpcAfterAttach(session, "companion/dictation/start", {
          ...(options.language === undefined ? {} : { language: options.language }),
          ...(options.capture === undefined ? {} : {
            captureSource: options.capture.source,
            noiseSuppressor: options.capture.noiseSuppressor,
            automaticGainControl: options.capture.automaticGainControl,
          }),
        });
        recordTiming("voice_start_ms", performance.now() - voiceStartAt);
      } catch (cause) {
        incrementMetric("voice_failures");
        throw cause;
      }
      const sessionId = asRecord(start)?.sessionId;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        incrementMetric("voice_failures");
        throw new Error("Companion returned an invalid dictation session");
      }
      let acceptingAudio = true;
      let disposed = false;
      let audioDrained = false;
      let finishInFlight: Promise<void> | null = null;
      let uploadError: string | null = null;
      const uploader = new RealtimeAudioUploader({
        send: async (batchId, chunks, signal) => await sendDictationBatchUntilAccepted(session, {
          sessionId,
          batchId: String(batchId),
          chunks,
        }, signal),
        onError: (message) => {
          uploadError = message;
          incrementMetric("voice_failures");
          if (!disposed) listener({ type: "error", message });
        },
      });
  
      const append = (chunk: VoiceAudioChunk) => {
        if (!acceptingAudio || disposed) return;
        uploader.append(chunk);
      };
      const close = async (flush: boolean) => {
        if (disposed) return;
        if (!flush) {
          acceptingAudio = false;
          await uploader.cancel();
          await rpcAfterAttach(session, "companion/dictation/cancel", { sessionId });
          disposed = true;
          return;
        }
        acceptingAudio = false;
        if (finishInFlight !== null) return await finishInFlight;
        const finishing = (async () => {
          if (!audioDrained) {
            const voiceDrainAt = performance.now();
            await uploader.finish();
            audioDrained = true;
            recordTiming("voice_drain_ms", performance.now() - voiceDrainAt);
          }
          if (uploadError !== null) {
            await rpcAfterAttach(session, "companion/dictation/cancel", { sessionId }).catch(() => undefined);
            disposed = true;
            throw new UnretryableVoiceTranscriptionError(uploadError);
          }
          const voiceFinishAt = performance.now();
          const response = asRecord(await finishDictationWithTransportRetry(session, sessionId));
          recordTiming("voice_finish_ms", performance.now() - voiceFinishAt);
          if (response?.retryable === true) {
            const retryAfterMs = typeof response.retryAfterMs === "number" && Number.isFinite(response.retryAfterMs)
              ? Math.max(0, response.retryAfterMs)
              : 1_000;
            throw new RetryableVoiceTranscriptionError(
              typeof response.message === "string" ? response.message : "OpenAI transcription can be retried",
              retryAfterMs,
            );
          }
          const text = response?.text;
          if (typeof text !== "string") throw new Error("Companion returned an invalid transcript");
          disposed = true;
          listener({ type: "done", text });
        })();
        finishInFlight = finishing;
        try {
          await finishing;
        } finally {
          if (finishInFlight === finishing) finishInFlight = null;
        }
      };
      return {
        appendAudio: append,
        finish: async () => await close(true),
        cancel: async () => await close(false),
      };
    };
  
    const refreshConnectionProfiles = async (): Promise<StoredConnection[]> => {
      return await requireConnectionProfileDatabase(workspaceRuntime.snapshot.connectionProfiles).hydrate();
    };
  
    const addConnection = async (input: ConnectionInput) => {
      // Pairing consumes a one-time host token. Prove that the durable local
      // projection is available before crossing that irreversible boundary.
      const profiles = requireConnectionProfileDatabase(workspaceRuntime.snapshot.connectionProfiles);
      if (Platform.OS === "android" && Platform.Version >= 33) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      const validated = validateConnectionInput(input);
      const connectionId = `saved-server-${randomUUID()}`;
      const claimed = await claimNativePairing({
        savedServerId: connectionId,
        endpoint: validated.endpoint,
        pairingToken: validated.token,
        deviceName: "CodeWide Android",
        tlsPinSha256: validated.tlsPinSha256,
      });
      const nativeCredentials = {
        connectionId,
        endpoint: validated.endpoint,
        token: claimed.capabilityToken,
        enabled: true,
        tlsPinSha256: validated.tlsPinSha256,
        deviceId: claimed.deviceId,
      };
      try {
        await saveNativeConnectionCredentials(nativeCredentials);
        const connection = await profiles.add({ ...validated, token: claimed.capabilityToken }, connectionId);
        wakeNativeConnection(connection.id);
        await refreshConnectionProfiles();
        workspaceRuntime.snapshot.connectionState?.setState(connection.id, "connecting", null, false);
        return connection;
      } catch (cause) {
        // A successful claim cannot be rolled back. Retain/retry the native
        // capability, then rebuild the disposable UI projection from Kotlin.
        // This also recovers a write that committed before reporting an error.
        try {
          await saveNativeConnectionCredentials(nativeCredentials);
          const nativeConfigs = await listNativeConnectionConfigs();
          await profiles.reconcileRuntimeConfigs(nativeConfigs);
          const reconciledProfiles = await refreshConnectionProfiles();
          const recovered = reconciledProfiles.find((connection) => connection.id === connectionId);
          if (recovered !== undefined) {
            wakeNativeConnection(recovered.id);
            workspaceRuntime.snapshot.connectionState?.setState(recovered.id, "connecting", null, false);
            return recovered;
          }
        } catch {
          // Preserve the original pairing failure below. Startup reconciliation
          // gets another chance if the native credential write did persist.
        }
        throw cause;
      }
    };
  
    const deleteConnection = async (connectionId: string) => {
      workspaceRuntime.supervisor?.session(connectionId)?.stop();
      const finalizeSavedServerDelete = async () => {
        await deleteNativeConnection(connectionId);
        await requireConnectionProfileDatabase(workspaceRuntime.snapshot.connectionProfiles).delete(connectionId);
      };
      await finalizeSavedServerDelete();
      workspaceRuntime.httpSessions.delete(connectionId);
      workspaceRuntime.threadObserverDesired.delete(connectionId);
      workspaceRuntime.threadCatalogRefreshedAt.delete(connectionId);
      for (const key of workspaceRuntime.subagentRefreshedAt.keys()) {
        if (key.startsWith(`${connectionId}\u0000`)) workspaceRuntime.subagentRefreshedAt.delete(key);
      }
      await refreshConnectionProfiles();
      workspaceRuntime.snapshot.connectionState?.remove(connectionId);
      workspaceRuntime.snapshot.accountRateLimits?.remove(connectionId);
      await workspaceRuntime.snapshot.threadUiState?.deleteConnection(connectionId);
    };
  
    const setConnectionEnabled = async (connectionId: string, enabled: boolean) => {
      const profiles = requireConnectionProfileDatabase(workspaceRuntime.snapshot.connectionProfiles);
      await setNativeConnectionEnabled(connectionId, enabled);
      await profiles.setEnabled(connectionId, enabled);
      if (!enabled) workspaceRuntime.supervisor?.session(connectionId)?.stop();
      if (!enabled) workspaceRuntime.threadObserverDesired.delete(connectionId);
      await refreshConnectionProfiles();
      workspaceRuntime.snapshot.connectionState?.setState(connectionId, enabled ? "connecting" : "offline", null, false);
    };
  
    const reconnectConnection = async (connectionId: string): Promise<void> => {
      const connection = currentConnections().find((candidate) => candidate.id === connectionId);
      if (connection === undefined || !connection.enabled) throw new Error("Connection is disabled or missing");
      workspaceRuntime.snapshot.connectionState?.setState(connectionId, "connecting", null, false);
      reconnectNativeConnection(connectionId);
    };
  
    const updateConnectionProfile = async (connectionId: string, displayName: string, emoji: string) => {
      await requireConnectionProfileDatabase(workspaceRuntime.snapshot.connectionProfiles).updateProfile(connectionId, displayName, emoji);
      await refreshConnectionProfiles();
    };
  
    const updateConnection = async (connectionId: string, input: ConnectionUpdateInput) => {
      const enabled = currentConnections().find((connection) => connection.id === connectionId)?.enabled ?? true;
      const profiles = requireConnectionProfileDatabase(workspaceRuntime.snapshot.connectionProfiles);
      const updated = validateConnectionRuntimeUpdate(input);
      await saveNativeConnectionCredentials({
        connectionId,
        endpoint: updated.endpoint,
        ...(updated.token === undefined ? {} : { token: updated.token }),
        enabled,
        ...(updated.tlsPinSha256 === undefined ? {} : { tlsPinSha256: updated.tlsPinSha256 }),
      });
      await profiles.update(connectionId, updated);
      if (enabled) wakeNativeConnection(connectionId);
      workspaceRuntime.httpSessions.delete(connectionId);
      await refreshConnectionProfiles();
      workspaceRuntime.snapshot.connectionState?.setState(connectionId, "connecting", null, false);
    };
  
    const moveConnection = async (connectionId: string, direction: -1 | 1) => {
      await requireConnectionProfileDatabase(workspaceRuntime.snapshot.connectionProfiles).move(connectionId, direction);
      await refreshConnectionProfiles();
    };
  
    const searchThreads = async (query: string, connectionId: string | null = null) => {
      return projectThreadHotStates(
        await workspaceRuntime.snapshot.threadSummaries?.search(query, connectionId) ?? [],
        workspaceRuntime.snapshot.pendingRequests?.collection.toArray ?? [],
      );
    };

    const listProjects = async (connectionId: string): Promise<RemoteProject[]> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      return parseRemoteProjects(await rpcAfterAttach(session, "companion/project/list", {}));
    };

    const addProject = async (connectionId: string, path: string): Promise<RemoteProject> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      return parseAddedRemoteProject(await rpcAfterAttach(session, "companion/project/add", { path }));
    };

    const readDirectory = async (connectionId: string, path: string): Promise<RemoteDirectoryEntry[]> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const response = await rpcAfterAttach<FsReadDirectoryResponse>(session, "fs/readDirectory", { path });
      return parseRemoteDirectory(response);
    };

    const inspectWorkspace = async (connectionId: string, workspace: string): Promise<WorkspaceSupport | null> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      return parseWorkspaceSupport(await rpcAfterAttach(session, "companion/workspace/inspect", { workspace }));
    };

    const createWorkspace = async (connectionId: string, workspace: string, requestId: string): Promise<CreatedWorkspace> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      return parseCreatedWorkspace(await rpcAfterAttach(session, "companion/workspace/create", { workspace, requestId }));
    };
  
    const setThreadPinned = async (connectionId: string, threadId: string, pinned: boolean) => {
      await requireThreadSummaryDatabase(workspaceRuntime.snapshot.threadSummaries).updatePinned(connectionId, threadId, pinned);
    };
  
    const startThread = async (connectionId: string, cwd?: string): Promise<string> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const response = await rpcAfterAttach<ThreadStartResponse>(session, "thread/start", cwd === undefined ? {} : { cwd });
      // thread/start already returns the authoritative execution settings.
      // Preserve them on the empty shell so a new conversation can paint its
      // model and permission chips before the first turn exists.
      const started = seedThreadExecutionSettings(response.thread, {
        model: response.model,
        effort: response.reasoningEffort,
        permissions: response.activePermissionProfile?.id ?? null,
        approvalPolicy: typeof response.approvalPolicy === "string" ? response.approvalPolicy : "granular",
        sandboxPolicy: response.sandbox.type,
      });
      await workspaceRuntime.snapshot.threadDetails?.importThreadSnapshot(connectionId, started, "initial");
      await workspaceRuntime.snapshot.threadSummaries?.insertStartedThread(connectionId, started);
      // Catalogs are scoped by server + cwd, not by turn. Warm them as soon as
      // the shell exists instead of waiting for thread/resume after a message.
      void loadTurnControls(connectionId, started.cwd).catch(() => undefined);
      return started.id;
    };

    const startThreadInWorkspace = async (
      connectionId: string,
      workspace: string,
      requestId: string,
    ): Promise<string> => {
      const started = await startThreadInCreatedWorkspace({
        createWorkspace: () => createWorkspace(connectionId, workspace, requestId),
        startThread: (cwd) => startThread(connectionId, cwd),
      });
      return started.threadId;
    };
  
    const renameThread = async (connectionId: string, threadId: string, name: string): Promise<void> => {
      await requireThreadSummaryDatabase(workspaceRuntime.snapshot.threadSummaries).updateName(connectionId, threadId, name);
    };
  
    const archiveThread = async (connectionId: string, threadId: string): Promise<void> => {
      await enqueueNativeCommand(connectionId, `thread-archive-${randomUUID()}`, "thread/archive", { threadId });
      await requireThreadSummaryDatabase(workspaceRuntime.snapshot.threadSummaries).updateArchived(connectionId, threadId, true);
    };
  
    const unarchiveThread = async (connectionId: string, threadId: string): Promise<void> => {
      await enqueueNativeCommand(connectionId, `thread-unarchive-${randomUUID()}`, "thread/unarchive", { threadId });
      await requireThreadSummaryDatabase(workspaceRuntime.snapshot.threadSummaries).updateArchived(connectionId, threadId, false);
    };
  
    const deleteThread = async (connectionId: string, threadId: string): Promise<void> => {
      const commandId = `thread-delete-${randomUUID()}`;
      const summaries = requireThreadSummaryDatabase(workspaceRuntime.snapshot.threadSummaries);
      await summaries.beginDelete(connectionId, threadId, commandId);
      try {
        await enqueueNativeCommand(connectionId, commandId, "thread/delete", { threadId });
      } catch (cause) {
        await summaries.rollbackDelete(connectionId, threadId, commandId);
        throw cause;
      }
    };
  
    const markThreadRead = async (connectionId: string, threadId: string): Promise<void> => {
      await workspaceRuntime.snapshot.threadSummaries?.markRead(connectionId, threadId);
    };
  
    const loadDraft = async (connectionId: string, threadId: string): Promise<string> => {
      return (await getOrCreateThreadUiState(connectionId, threadId, workspaceRuntime.snapshot.threadUiState, workspaceRuntime.threadUiStateSeedInFlight)).draftText;
    };
  
    const saveDraft = async (connectionId: string, threadId: string, text: string): Promise<void> => {
      await requireThreadUiStateDatabase(workspaceRuntime.snapshot.threadUiState).saveDraft(connectionId, threadId, text);
    };
  
    const loadDraftAttachments = async (connectionId: string, threadId: string): Promise<StoredDraftAttachment[]> => {
      return (await getOrCreateThreadUiState(connectionId, threadId, workspaceRuntime.snapshot.threadUiState, workspaceRuntime.threadUiStateSeedInFlight)).attachments;
    };
  
    const saveDraftAttachments = async (connectionId: string, threadId: string, attachments: StoredDraftAttachment[]): Promise<void> => {
      await requireThreadUiStateDatabase(workspaceRuntime.snapshot.threadUiState).saveAttachments(connectionId, threadId, attachments);
    };
  
    const loadScrollOffset = async (connectionId: string, threadId: string): Promise<number | null> => {
      return (await getOrCreateThreadUiState(connectionId, threadId, workspaceRuntime.snapshot.threadUiState, workspaceRuntime.threadUiStateSeedInFlight)).scrollOffset;
    };
  
    const saveScrollOffset = async (connectionId: string, threadId: string, offset: number, historyAnchorTurnId: string | null, historyAnchorOffsetPx: number | null): Promise<void> => {
      await requireThreadUiStateDatabase(workspaceRuntime.snapshot.threadUiState).saveScrollOffset(connectionId, threadId, offset, historyAnchorTurnId, historyAnchorOffsetPx);
    };
  
    const loadComposerPreferences = async (connectionId: string, threadId: string) => {
      return (await getOrCreateThreadUiState(connectionId, threadId, workspaceRuntime.snapshot.threadUiState, workspaceRuntime.threadUiStateSeedInFlight)).preferences;
    };
  
    const saveComposerPreferences = async (
      connectionId: string,
      threadId: string,
      preferences: StoredComposerPreferences,
    ) => {
      await requireThreadUiStateDatabase(workspaceRuntime.snapshot.threadUiState).savePreferences(connectionId, threadId, preferences);
    };
  
    const listQueuedPrompts = async (connectionId: string, threadId: string): Promise<QueuedPrompt[]> => {
      const details = workspaceRuntime.snapshot.threadDetails;
      if (details === null) return [];
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session !== undefined) {
        try {
          const mirrored = await rpcAfterAttach<{ data: unknown }>(session, "companion/queue/list", { threadId });
          const commands = parseHostQueueSnapshot(mirrored.data);
          if (commands === null) throw new Error("Companion queue snapshot is invalid");
          const nativeCommands = await listNativeCommands();
          const pending = new Set(nativeCommands
            .filter((delivery) => delivery.connectionId === connectionId
              && delivery.method === "companion/queue/put"
              && delivery.state !== "delivered")
            .flatMap((delivery) => delivery.targetCommandId === null ? [] : [delivery.targetCommandId]));
          await details.replaceQueued(connectionId, threadId, commands, pending);
        } catch {
          // The persisted Legend chat projection remains available offline.
        }
      }
      return details.listQueued(connectionId, threadId)
        .filter(({ state }) => state !== "delivered")
        .map(({ commandId, text, attachments, createdAt, state, lastError }) => ({
          commandId,
          text,
          attachments,
          createdAt,
          state: state === "failed" || state === "uncertain" ? state : "queued",
          lastError,
        }));
    };
  
    const editQueuedPrompt = async (connectionId: string, commandId: string, text: string, attachments: RemoteFileAttachment[]): Promise<void> => {
      const normalized = text.trim();
      if (normalized.length < 1 && attachments.length === 0) throw new Error("Queued message cannot be empty");
      if (normalized.length > MAX_TURN_TEXT_CHARS) throw new Error(`Queued message exceeds ${MAX_TURN_TEXT_CHARS} characters`);
      const details = workspaceRuntime.snapshot.threadDetails;
      if (details === null) throw new Error("Local timeline database is not ready");
      const mutation = details.planQueuedEdit(connectionId, commandId, normalized, attachments);
      if (mutation === null) throw new Error("Queued prompt is already dispatching or no longer exists");
      await runOptimisticPendingMutation(details, mutation, async () => {
        await enqueueNativeCommand(connectionId, `queue-edit-${randomUUID()}`, "companion/queue/edit", {
          commandId,
          text: normalized,
          input: queuedInputPayload(normalized, attachments),
        });
      });
    };
  
    const cancelQueuedPrompt = async (connectionId: string, commandId: string): Promise<void> => {
      const details = workspaceRuntime.snapshot.threadDetails;
      if (details === null) throw new Error("Local timeline database is not ready");
      const mutation = details.planQueuedRemoval(connectionId, commandId);
      if (mutation === null) throw new Error("Queued prompt is already dispatching or no longer exists");
      await runOptimisticPendingMutation(details, mutation, async () => {
        await enqueueNativeCommand(connectionId, `queue-cancel-${randomUUID()}`, "companion/queue/cancel", { commandId });
      });
    };
  
    const moveQueuedPrompt = async (
      connectionId: string,
      threadId: string,
      commandId: string,
      direction: -1 | 1,
    ): Promise<void> => {
      const details = workspaceRuntime.snapshot.threadDetails;
      if (details === null) throw new Error("Local timeline database is not ready");
      const mutation = details.planQueuedMove(connectionId, threadId, commandId, direction);
      if (mutation === null) return;
      await runOptimisticPendingMutation(details, mutation, async () => {
        await enqueueNativeCommand(connectionId, `queue-move-${randomUUID()}`, "companion/queue/move", {
          commandId,
          beforeCommandId: mutation.beforeCommandId ?? null,
        });
      });
    };

    const steerQueuedPrompt = async (connectionId: string, commandId: string, expectedTurnId: string): Promise<void> => {
      await enqueueNativeCommand(connectionId, `queue-steer-${randomUUID()}`, "companion/queue/steer", {
        commandId,
        expectedTurnId,
      });
    };
  
    const listBackgroundTerminals = async (connectionId: string, threadId: string): Promise<BackgroundTerminal[]> => {
      const key = threadResourceKey(connectionId, threadId);
      const previous = workspaceRuntime.resourceDatabase.backgroundTerminals.get(key);
      workspaceRuntime.resourceDatabase.putBackgroundTerminals({
        id: key,
        connectionId,
        threadId,
        status: "loading",
        items: previous?.items ?? [],
        error: null,
      });
      const session = workspaceRuntime.supervisor?.session(connectionId);
      try {
        if (session === undefined) throw new Error("Connection is not enabled");
        const response = await rpcAfterAttach<ThreadBackgroundTerminalsListResponse>(session,
          "thread/backgroundTerminals/list",
          { threadId, cursor: null, limit: 100 },
        );
        const items = response.data.map((terminal) => ({
          ...terminal,
          rssKb: terminal.rssKb === null ? null : String(terminal.rssKb),
        }));
        workspaceRuntime.resourceDatabase.putBackgroundTerminals({ id: key, connectionId, threadId, status: "ready", items, error: null });
        return items;
      } catch (cause) {
        workspaceRuntime.resourceDatabase.putBackgroundTerminals({
          id: key,
          connectionId,
          threadId,
          status: "error",
          items: previous?.items ?? [],
          error: errorMessage(cause),
        });
        throw cause;
      }
    };
  
    const terminateBackgroundTerminal = async (
      connectionId: string,
      threadId: string,
      processId: string,
    ): Promise<boolean> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const response = await rpcAfterAttach<ThreadBackgroundTerminalsTerminateResponse>(session,
        "thread/backgroundTerminals/terminate",
        { threadId, processId },
      );
      if (response.terminated) {
        const key = threadResourceKey(connectionId, threadId);
        const current = workspaceRuntime.resourceDatabase.backgroundTerminals.get(key);
        if (current !== undefined) workspaceRuntime.resourceDatabase.putBackgroundTerminals({
          id: key,
          connectionId,
          threadId,
          status: "ready",
          items: current.items.filter((terminal) => terminal.processId !== processId),
          error: null,
        });
      }
      return response.terminated;
    };

    const loadThreadResources = async (
      connectionId: string,
      threadId: string,
      scope?: ThreadChangeScope,
      kind: ThreadResourceLoadKind = "all",
    ): Promise<ThreadResourcesValue> => {
      const key = threadResourceKey(connectionId, threadId);
      const inFlightKey = `${key}\u0000${kind}\u0000${scope ?? "initial"}`;
      const requestedKinds = threadResourceKinds(kind);
      const pending = workspaceRuntime.threadResourcesInFlight.get(inFlightKey);
      if (pending !== undefined) return await pending;
      const conflict = [...workspaceRuntime.threadResourcesInFlight.entries()].find(([candidate]) => {
        if (!candidate.startsWith(`${key}\u0000`)) return false;
        const candidateKind = candidate.slice(`${key}\u0000`.length).split("\u0000", 1)[0];
        return kind === "all" || candidateKind === "all" || candidateKind === kind;
      })?.[1];
      if (conflict !== undefined) {
        try {
          await conflict;
        } catch {
          // The requested resource still deserves its own retry after a
          // conflicting refresh failed.
        }
        const settled = workspaceRuntime.resourceDatabase.threadResources.get(key);
        const settledReadyKinds = initializedThreadResourceKinds(settled);
        if (
          settled?.value !== null
          && settled?.value !== undefined
          && requestedKinds.every((requestedKind) => settledReadyKinds.includes(requestedKind))
          && (kind !== "changes" || scope === undefined || settled.value.changeScope === scope)
        ) return settled.value;
        return await loadThreadResources(connectionId, threadId, scope, kind);
      }
      const operation = (async () => {
        const previousRow = workspaceRuntime.resourceDatabase.threadResources.get(key);
        const previous = previousRow?.value ?? null;
        workspaceRuntime.resourceDatabase.putThreadResources({
          id: key,
          connectionId,
          threadId,
          status: "loading",
          value: previous,
          error: null,
          pendingKinds: mergeThreadResourceKinds(previousRow?.pendingKinds ?? [], requestedKinds),
          readyKinds: initializedThreadResourceKinds(previousRow),
          resourceErrors: clearThreadResourceErrors(previousRow?.resourceErrors, requestedKinds),
        });
        try {
          const session = workspaceRuntime.supervisor?.session(connectionId);
          if (session === undefined) throw new Error("Connection is not enabled");
          const expectedRecencyAt = (await workspaceRuntime.snapshot.threadSummaries?.get(connectionId, threadId))?.recencyAt ?? null;
          const method = kind === "changes"
            ? "companion/threadChanges/read"
            : kind === "attachments"
              ? "companion/threadAttachments/read"
              : "companion/threadResources/read";
          const response = await rpcAfterAttach<unknown>(session, method, {
            threadId,
            ...(scope === undefined ? {} : { changeScope: scope }),
            ...(expectedRecencyAt === null ? {} : { expectedRecencyAt }),
          });
          const patch = parseThreadResourcesPatch(response, threadId, kind);
          const current = workspaceRuntime.resourceDatabase.threadResources.get(key);
          const value = mergeThreadResources(current?.value ?? previous, patch);
          const pendingKinds = subtractThreadResourceKinds(current?.pendingKinds ?? requestedKinds, requestedKinds);
          workspaceRuntime.resourceDatabase.putThreadResources({
            id: key,
            connectionId,
            threadId,
            status: pendingKinds.length > 0 ? "loading" : "ready",
            value,
            error: null,
            pendingKinds,
            readyKinds: mergeThreadResourceKinds(initializedThreadResourceKinds(current), requestedKinds),
            resourceErrors: clearThreadResourceErrors(current?.resourceErrors, requestedKinds),
          });
          return workspaceRuntime.resourceDatabase.threadResources.get(key)?.value ?? value;
        } catch (cause) {
          const current = workspaceRuntime.resourceDatabase.threadResources.get(key);
          const pendingKinds = subtractThreadResourceKinds(current?.pendingKinds ?? requestedKinds, requestedKinds);
          const message = errorMessage(cause);
          workspaceRuntime.resourceDatabase.putThreadResources({
            id: key,
            connectionId,
            threadId,
            status: pendingKinds.length > 0 ? "loading" : "error",
            value: current?.value ?? previous,
            error: message,
            pendingKinds,
            readyKinds: initializedThreadResourceKinds(current),
            resourceErrors: setThreadResourceErrors(current?.resourceErrors, requestedKinds, message),
          });
          throw cause;
        }
      })();
      workspaceRuntime.threadResourcesInFlight.set(inFlightKey, operation);
      try {
        return await operation;
      } finally {
        if (workspaceRuntime.threadResourcesInFlight.get(inFlightKey) === operation) workspaceRuntime.threadResourcesInFlight.delete(inFlightKey);
      }
    };

    const loadThreadChangeDiff = async (connectionId: string, threadId: string, path: string, scope?: ThreadChangeScope): Promise<ThreadChangeDiffValue> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const response = await rpcAfterAttach<unknown>(session, "companion/threadChange/read", {
        threadId,
        path,
        ...(scope === undefined ? {} : { changeScope: scope }),
      });
      return parseThreadChangeDiff(response, threadId, path, scope);
    };

    const refreshThreadCatalog = (connectionId: string, force = false): Promise<void> => {
      const now = Date.now();
      if (!force && now - (workspaceRuntime.threadCatalogRefreshedAt.get(connectionId) ?? 0) < THREAD_CATALOG_REPAIR_INTERVAL_MS) {
        return Promise.resolve();
      }
      const pending = workspaceRuntime.threadCatalogRefreshInFlight.get(connectionId);
      if (pending !== undefined) return pending;
      const operation = (async () => {
        const session = workspaceRuntime.supervisor?.session(connectionId);
        const summaries = workspaceRuntime.snapshot.threadSummaries;
        if (session === undefined || summaries === null) return;
        const catalog = await loadThreadCatalog(session);
        await summaries.replaceCatalog(connectionId, catalog);
        workspaceRuntime.threadCatalogRefreshedAt.set(connectionId, Date.now());
      })().finally(() => {
        if (workspaceRuntime.threadCatalogRefreshInFlight.get(connectionId) === operation) {
          workspaceRuntime.threadCatalogRefreshInFlight.delete(connectionId);
        }
      });
      workspaceRuntime.threadCatalogRefreshInFlight.set(connectionId, operation);
      return operation;
    };

    const refreshSubagents = (connectionId: string, rootThreadId: string, force = false): Promise<void> => {
      const key = `${connectionId}\u0000${rootThreadId}`;
      const now = Date.now();
      if (!force && now - (workspaceRuntime.subagentRefreshedAt.get(key) ?? 0) < THREAD_CATALOG_REPAIR_INTERVAL_MS) {
        return Promise.resolve();
      }
      const pending = workspaceRuntime.subagentRefreshInFlight.get(key);
      if (pending !== undefined) return pending;
      const operation = (async () => {
        const session = workspaceRuntime.supervisor?.session(connectionId);
        const summaries = workspaceRuntime.snapshot.threadSummaries;
        if (session === undefined || summaries === null) return;
        const descendants = await loadSubagentDescendants(session, rootThreadId);
        await summaries.replaceSubagentCatalog(connectionId, rootThreadId, descendants);
        workspaceRuntime.subagentRefreshedAt.set(key, Date.now());
      })().finally(() => {
        if (workspaceRuntime.subagentRefreshInFlight.get(key) === operation) {
          workspaceRuntime.subagentRefreshInFlight.delete(key);
        }
      });
      workspaceRuntime.subagentRefreshInFlight.set(key, operation);
      return operation;
    };

    const observeThread = (
      connectionId: string,
      threadId: string,
      keepAcrossReconnect = true,
    ): Promise<void> => {
      if (keepAcrossReconnect) workspaceRuntime.threadObserverDesired.set(connectionId, threadId);
      const key = `${connectionId}\u0000${threadId}`;
      const existing = workspaceRuntime.threadObserverAttachInFlight.get(key);
      if (existing !== undefined) return existing;
      const operation = (async (): Promise<void> => {
        const session = workspaceRuntime.supervisor?.session(connectionId);
        if (session === undefined) throw new Error("Connection is not enabled");
        // This resume attaches the Companion App Server connection to live
        // notifications. It is intentionally not the history source and must
        // never hold navigation behind a large thread: the indexed bounded
        // window remains the only history loader.
        await rpcAfterAttach(session, "companion/thread/observe", {
          threadId,
        });
      })().finally(() => {
        if (workspaceRuntime.threadObserverAttachInFlight.get(key) === operation) {
          workspaceRuntime.threadObserverAttachInFlight.delete(key);
        }
      });
      workspaceRuntime.threadObserverAttachInFlight.set(key, operation);
      return operation;
    };
  
    const readThread = async (
      connectionId: string,
      threadId: string,
      cachedThread?: Thread | null,
      requireAuthoritative = false,
      mutableHeadOnly = false,
    ): Promise<ThreadWindow | null> => {
      const requestKey = `${connectionId}\u0000${threadId}`;
      const requestedAuthority: "local" | "mutable-head" | "recovery" = requireAuthoritative
        ? "recovery"
        : mutableHeadOnly
          ? "mutable-head"
          : "local";
      const authorityRank = (authority: "local" | "mutable-head" | "recovery"): number => (
        authority === "recovery" ? 2 : authority === "mutable-head" ? 1 : 0
      );
      while (true) {
        const inFlight = workspaceRuntime.threadReadInFlight.get(requestKey);
        if (inFlight === undefined) break;
        if (authorityRank(inFlight.authority) >= authorityRank(requestedAuthority)) {
          return await inFlight.promise;
        }
        // A stronger repair never races a weaker cache-aside read. Wait for
        // its durable commit, then re-evaluate the single per-thread lane.
        try {
          await inFlight.promise;
        } catch {
          // The authoritative request below is the recovery boundary.
        }
      }
      const operation = (async (): Promise<ThreadWindow | null> => {
        const details = workspaceRuntime.snapshot.threadDetails;
        const summaries = workspaceRuntime.snapshot.threadSummaries;
        // `undefined` means "use the resident cache"; explicit `null` is the
        // cache-aside miss signal from the range model and must cross the
        // authoritative boundary. Nullish coalescing used to erase that
        // distinction, accepting metadata-only rows as an empty thread.
        const cached = cachedThread === undefined
          ? details?.getThread(connectionId, threadId) ?? null
          : cachedThread;
        const initialTurnsLimit = threadResumePageLimit(cached?.turns.length ?? 0);
        // Capture before sending the authoritative request. Only invalidations at
        // or below this cursor can be cleared by its response; newer events stay
        // dirty and force another refresh instead of being lost in a race.
        const refreshCursor = details?.captureRefreshCursor(connectionId, threadId) ?? null;
        const syncPlan = planThreadOpenSync(cached !== null, refreshCursor, requireAuthoritative);
        const session = workspaceRuntime.supervisor?.session(connectionId);
        if (session === undefined) {
          await reconcileActiveThreadCommands(details, connectionId, threadId);
          if (requireAuthoritative) throw new Error("Authoritative thread repair requires an active connection");
          return cached === null ? null : { thread: residentThreadWindow(cached), nextCursor: details?.historyCursor(connectionId, threadId) };
        }
        // The global state-DB snapshot may omit older spawned descendants.
        // Refresh them independently so opening the chat is never blocked by
        // rollout scanning and the chip updates as soon as the index arrives.
        void refreshSubagents(connectionId, threadId).catch((cause: unknown) => {
          console.warn("CodeWide subagent refresh failed:", cause instanceof Error ? cause.message : "unknown error");
        });
        let unresolvedDeliveredReceipt = false;
        if (cached !== null && syncPlan === "local") {
          // The ordered replay journal has already advanced this durable
          // projection. Opening a known chat is therefore a local SQLite read,
          // not an implicit thread/resume round-trip. A delivered native
          // receipt without its canonical user item is the one exception: the
          // app may have slept through queue/changed, so perform a bounded
          // cursor catch-up instead of leaving `Sent` terminal forever.
          unresolvedDeliveredReceipt = await reconcileActiveThreadCommands(details, connectionId, threadId);
          if (!unresolvedDeliveredReceipt) {
            void loadTurnControls(connectionId, cached.cwd).catch(() => undefined);
            return { thread: residentThreadWindow(cached), nextCursor: details?.historyCursor(connectionId, threadId) };
          }
        }
        if (cached !== null && threadOpenNeedsCursorCatchUp(syncPlan, unresolvedDeliveredReceipt)) {
          const cursorStartedAt = performance.now();
          const localCursorTurnId = requireAuthoritative
            ? null
            : await details?.latestSealedTurnId(connectionId, threadId) ?? latestSealedTurnId(cached.turns);
          const delta = await collectThreadCursorDelta(
            localCursorTurnId,
            async (cursor) => await rpcAfterAttach<ThreadTurnsListResponse>(session, "thread/turns/list", {
              threadId,
              cursor,
              limit: THREAD_HISTORY_PAGE_SIZE,
              sortDirection: "desc",
              itemsView: "summary",
            }),
          );
          recordTiming("thread_cursor_sync_ms", performance.now() - cursorStartedAt);
          if (delta.anchorFound && details !== null) {
            const appended = await details.appendTurns(connectionId, threadId, delta.turns, refreshCursor, delta.historyCursor);
            if (appended.accepted) {
              await reconcileActiveThreadCommands(details, connectionId, threadId);
              const projected = details.getThread(connectionId, threadId) ?? cached;
              const persistedHistoryCursor = details.historyCursor(connectionId, threadId);
              void loadTurnControls(connectionId, projected.cwd).catch(() => undefined);
    return {
                thread: residentThreadWindow(projected),
                nextCursor: persistedHistoryCursor === undefined ? delta.historyCursor : persistedHistoryCursor,
              };
            }
          }
          // A missing cursor means the canonical history was replaced or the
          // local cache belongs to a disconnected epoch. Only this explicit
          // recovery boundary may replace a resident thread snapshot.
          incrementMetric("thread_cursor_recovery_fallbacks");
        }
        const persistHydratedThread = async (hydrated: Thread, historyCursor: string | null): Promise<void> => {
          let stage = "detail_import";
          try {
            // Cache-aside hydration exists to populate this exact database.
            // Treating an unavailable owner as a successful optional write
            // used to let the caller install an empty reread as a ready chat.
            if (details === null) throw new Error("Thread history database is not available");
            await details.importThreadSnapshot(connectionId, hydrated, "recovery", refreshCursor, historyCursor);
            stage = "pending_reconciliation";
            await reconcileActiveThreadCommands(details, connectionId, threadId);
            stage = "summary_merge";
            if (summaries !== null) {
              const previous = await summaries.get(connectionId, threadId);
              await summaries.mergeSnapshots(connectionId, [{
                thread: hydrated,
                archived: previous?.archived ?? workspaceRuntime.threadInvalidationArchived.get(requestKey) ?? false,
              }]);
            }
            recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.hydration_persisted", {
              values: { turnCount: hydrated.turns.length },
              tags: { nextCursor: historyCursor === null ? "exhausted" : "available" },
            });
          } catch (cause) {
            recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.hydration_persist_failed", {
              tags: { stage, errorKind: telemetryErrorKind(cause) },
            });
            throw cause;
          }
        };
        if (mutableHeadOnly && cached !== null) {
          const readStartedAt = performance.now();
          const response = await rpcAfterAttach<CompanionThreadResumeResponse>(session, "companion/threadWindow/read", {
            threadId,
            initialTurnsPage: {
              limit: initialTurnsLimit,
              sortDirection: "desc",
              itemsView: "summary",
            },
          });
          recordTiming("thread_mutable_head_read_ms", performance.now() - readStartedAt);
          const hydrated = materializeAuthoritativeThreadWindow(response, cached);
          const historyCursor = response.initialTurnsPage?.nextCursor ?? null;
          await persistHydratedThread(hydrated, historyCursor);
          void loadTurnControls(connectionId, hydrated.cwd).catch(() => undefined);
          return { thread: hydrated, nextCursor: historyCursor };
        }
        let hydratedWindow: ThreadWindow;
        try {
          const readStartedAt = performance.now();
          const response = await rpcAfterAttach<CompanionThreadResumeResponse>(session, "companion/threadWindow/read", {
            threadId,
            initialTurnsPage: {
              limit: initialTurnsLimit,
              sortDirection: "desc",
              itemsView: "summary",
            },
          });
          recordTiming("thread_window_read_ms", performance.now() - readStartedAt);
          let page = response.initialTurnsPage;
          if (page === null && response.turnsBackwardsCursor !== null) {
            page = await rpcAfterAttach<ThreadTurnsListResponse>(session, "thread/turns/list", {
              threadId,
              cursor: response.turnsBackwardsCursor,
              limit: initialTurnsLimit,
              sortDirection: "desc",
              itemsView: "summary",
            });
          }
          const hydrated = materializeResumedThread(
            page === response.initialTurnsPage ? response : { ...response, initialTurnsPage: page },
          );
          hydratedWindow = { thread: hydrated, nextCursor: page?.nextCursor ?? null };
          recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.authoritative_window_received", {
            values: { turnCount: hydrated.turns.length },
            tags: { nextCursor: page?.nextCursor == null ? "exhausted" : "available" },
          });
        } catch (cause) {
          recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.authoritative_window_rejected", {
            tags: { errorKind: telemetryErrorKind(cause) },
          });
          console.warn("CodeWide indexed thread window read failed:", cause instanceof Error ? cause.message : "unknown error");
          try {
            // Viewing history must still work when the thread cannot be resumed
            // (for example, another app-server process owns a paginated writer).
            // Both requests are read-only and preserve cursor-based lazy loading.
            const read = await rpcAfterAttach<ThreadReadResponse>(session, "thread/read", {
              threadId,
              includeTurns: false,
            });
            const page = await rpcAfterAttach<ThreadTurnsListResponse>(session, "thread/turns/list", {
              threadId,
              cursor: null,
              limit: initialTurnsLimit,
              sortDirection: "desc",
              itemsView: "summary",
              expectedRecencyAt: read.thread.recencyAt,
              expectedThreadActive: read.thread.status.type === "active",
            });
            if (page.data.length === 0 && page.nextCursor !== null) {
              throw new Error("Thread history fallback returned an empty page with a continuation cursor");
            }
            const hydrated = materializeReadOnlyThreadWindow(read.thread, [...page.data].reverse(), cached);
            hydratedWindow = { thread: hydrated, nextCursor: page.nextCursor };
            recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.read_only_fallback_received", {
              values: { turnCount: hydrated.turns.length },
              tags: { nextCursor: page.nextCursor === null ? "exhausted" : "available" },
            });
          } catch (fallbackCause) {
            recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.read_only_fallback_rejected", {
              tags: { errorKind: telemetryErrorKind(fallbackCause) },
            });
            console.warn("CodeWide read-only thread fallback failed:", fallbackCause instanceof Error ? fallbackCause.message : "unknown error");
            if (!requireAuthoritative && cached !== null && cached.turns.length > 0) {
              return { thread: residentThreadWindow(cached), nextCursor: details?.historyCursor(connectionId, threadId) };
            }
            throw fallbackCause;
          }
        }
        // Persistence is outside the source-selection catch. A SQLite or
        // projection failure must surface as such; retrying against a weaker
        // read source used to overwrite a valid bounded window with an empty
        // shell and permanently strand cold-cache navigation.
        await persistHydratedThread(hydratedWindow.thread, hydratedWindow.nextCursor ?? null);
        void loadTurnControls(connectionId, hydratedWindow.thread.cwd).catch(() => undefined);
        return hydratedWindow;
      })();
      const flight = { authority: requestedAuthority, promise: operation };
      workspaceRuntime.threadReadInFlight.set(requestKey, flight);
      try {
        return await operation;
      } finally {
        if (workspaceRuntime.threadReadInFlight.get(requestKey) === flight) workspaceRuntime.threadReadInFlight.delete(requestKey);
      }
    };

    const repairThreadProjection = async (
      connectionId: string,
      threadId: string,
      indexedHeadOnly = false,
    ): Promise<ThreadWindow | null> => {
      const cached = workspaceRuntime.snapshot.threadDetails?.getThread(connectionId, threadId);
      return await readThread(connectionId, threadId, cached, true, indexedHeadOnly && cached !== null && cached !== undefined);
    };
  
    const loadOlderTurns = async (connectionId: string, threadId: string, cursor: string | null, expectedHistoryEpoch: number): Promise<ThreadTurnPage> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const startedAt = performance.now();
      const page = await rpcAfterAttach<ThreadTurnsListResponse>(session, "thread/turns/list", {
        threadId,
        cursor,
        limit: THREAD_HISTORY_PAGE_SIZE,
        sortDirection: "desc",
        // Summary is the modern fast path: user prompt + final answer. Full
        // activity is loaded for one turn only when the user expands it.
        itemsView: "summary",
      });
      recordTiming("history_page_rpc_ms", performance.now() - startedAt);
      const turns = [...page.data].reverse();
      const threadDetails = workspaceRuntime.snapshot.threadDetails;
      if (threadDetails === null) throw new Error("Thread history database is not available");
      const persisted = await threadDetails.prependTurns(
        connectionId,
        threadId,
        expectedHistoryEpoch,
        turns,
        page.nextCursor,
      );
      if (!persisted.accepted) throw new Error("Backend history page was not persisted");
      return {
        turns,
        nextCursor: page.nextCursor,
        acceptedHistory: true,
        extendedHistory: persisted.extendedMinimum,
      };
    };

    const loadTurnItems = async (connectionId: string, threadId: string, turnId: string): Promise<Turn["items"]> => {
      const requestKey = `${connectionId}\u0000${threadId}\u0000${turnId}`;
      const pending = workspaceRuntime.turnItemsInFlight.get(requestKey);
      if (pending !== undefined) return await pending;
      const operation = (async (): Promise<Turn["items"]> => {
        const session = workspaceRuntime.supervisor?.session(connectionId);
        if (session === undefined) throw new Error("Connection is not enabled");
        const startedAt = performance.now();
        let items: Turn["items"];
        try {
          items = [];
          let cursor: string | null = null;
          do {
            const page: ThreadItemsListResponse = await rpcAfterAttach<ThreadItemsListResponse>(session, "thread/items/list", {
              threadId,
              turnId,
              cursor,
              limit: 100,
              sortDirection: "asc",
            });
            items.push(...page.data.map((entry) => entry.item));
            if (page.nextCursor !== null && page.nextCursor === cursor) throw new Error("Server returned a repeated item cursor");
            cursor = page.nextCursor;
          } while (cursor !== null);
        } catch (cause) {
          // Hermes can observe an RPC error through a different bundled module
          // realm after OTA. Do not make the protocol fallback depend solely on
          // `instanceof`, otherwise the server's -32601 leaks into the Activity UI.
          if (rpcResponseErrorCode(cause) !== -32601) throw cause;
          // Current Codex builds expose thread/items/list in the schema but reject
          // it at runtime. Hydrate the requested turn through paginated full turns
          // instead of rendering a permanently unavailable Activity section.
          items = await loadTurnItemsFromFullTurns(session, threadId, turnId);
        }
        recordTiming("turn_items_rpc_ms", performance.now() - startedAt);
        await workspaceRuntime.snapshot.threadDetails?.replaceTurnItems(connectionId, threadId, turnId, items);
        return items;
      })();
      workspaceRuntime.turnItemsInFlight.set(requestKey, operation);
      try {
        return await operation;
      } finally {
        if (workspaceRuntime.turnItemsInFlight.get(requestKey) === operation) {
          workspaceRuntime.turnItemsInFlight.delete(requestKey);
        }
      }
    };
  
    const sendText = async (
      connectionId: string,
      threadId: string,
      text: string,
      mode: SendMode = { type: "start" },
      options: TurnSendOptions = {},
    ): Promise<string> => {
      const details = workspaceRuntime.snapshot.threadDetails;
      if (details === null) throw new Error("Local timeline database is not ready");
      const command = createTextOutboxCommand(
        connectionId,
        threadId,
        text,
        mode,
        options,
        `android-${randomUUID()}`,
      );
      const presentation = mode.type === "queue" ? "queue" as const : "delivery" as const;
      const pending = details.createPending({
        connectionId,
        threadId,
        commandId: command.commandId,
        method: command.method,
        presentation,
        workspaceRequestId: options.workspaceRequestId ?? null,
        text,
        attachments: options.attachments ?? [],
        state: "queued",
        attempts: 0,
        lastError: null,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      });
      const optimistic = details.stagePendingMutation({ upserts: [pending], deletes: [] });
      try {
        await commitNativeThenProject(
          async () => {
            if (presentation === "queue" || options.workspaceRequestId !== undefined) {
              await enqueueNativeCommand(connectionId, `queue-put-${randomUUID()}`, "companion/queue/put", {
                command: {
                  ...command,
                  presentation,
                  ...(options.workspaceRequestId === undefined ? {} : { workspaceRequestId: options.workspaceRequestId }),
                },
              });
            } else {
              await enqueueNativeCommand(connectionId, command.commandId, command.method, command.params);
            }
          },
          async () => {
            const projected = await details.commitPending({
              ...pending,
              pending: pending.pending === null || pending.pending === undefined
                ? null
                : { ...pending.pending, state: "queued", updatedAt: Date.now() },
            }, { durable: true });
            if (!projected) console.warn("Accepted command will be reconciled from the native outbox when the thread becomes active");
          },
        );
        optimistic.complete();
      } catch (cause) {
        optimistic.rollback();
        throw cause;
      }
      return command.commandId;
    };

    const retryFailedMessage = async (connectionId: string, commandId: string): Promise<void> => {
      const details = workspaceRuntime.snapshot.threadDetails;
      const original = (await listNativeCommands()).find((delivery) =>
        delivery.connectionId === connectionId && delivery.commandId === commandId,
      );
      if (original?.method === "turn/start" && original.state === "failed") {
        const retrying = { ...original, state: "sending" as const, lastError: null, updatedAt: Date.now() };
        await commitNativeThenProject(
          async () => await enqueueNativeCommand(connectionId, `queue-retry-${randomUUID()}`, "companion/queue/retry", { commandId }),
          async () => await details?.applyCommandDelivery(retrying),
        );
        return;
      }
      await commitNativeThenProject(
        async () => await retryNativeCommand(connectionId, commandId),
        async (delivery) => await details?.applyCommandDelivery(delivery),
      );
    };
  
    const loadTurnControls = async (connectionId: string, cwd: string): Promise<TurnControls> => {
      const cacheKey = turnControlsResourceKey(connectionId, cwd);
      const resources = workspaceRuntime.snapshot.resources;
      const cached = resources?.turnControls.get(cacheKey);
      const pending = workspaceRuntime.turnControlsInFlight.get(cacheKey);
      if (pending !== undefined) return await pending;
      const session = workspaceRuntime.supervisor?.session(connectionId);
      const cachedValue = cached?.value === null || cached?.value === undefined
        ? null
        : cloneTurnControls(cached.value);
      const cacheFresh = isTurnControlsCacheFresh(cached, Date.now(), TURN_CONTROLS_FRESH_MS);
      if (cacheFresh && cachedValue !== null) return cachedValue;
      if (session === undefined) {
        if (cachedValue !== null) return cachedValue;
        throw new Error("Connection is not enabled");
      }
      const operation = (async (): Promise<TurnControls> => {
        try {
          resources?.putTurnControls({
            id: cacheKey,
            connectionId,
            cwd,
            status: cachedValue === null ? "loading" : "refreshing",
            value: cachedValue,
            error: null,
          });
          const result = await loadTurnControlsIncrementally(
            cachedValue ?? EMPTY_TURN_CONTROLS,
            {
              models: async () => {
                const response = await rpcAfterAttach<ModelListResponse>(session, "model/list", { cursor: null, limit: 100, includeHidden: false });
                return response.data.map((model) => ({
                  id: model.model,
                  label: model.displayName,
                  defaultEffort: model.defaultReasoningEffort,
                  efforts: model.supportedReasoningEfforts.map((option) => option.reasoningEffort),
                  supportsPersonality: model.supportsPersonality,
                  isDefault: model.isDefault,
                }));
              },
              skills: async () => {
                const response = await rpcAfterAttach<SkillsListResponse>(session, "skills/list", { cwds: [cwd], forceReload: false });
                return response.data.flatMap((entry) => entry.skills.map((skill) => ({
                  name: skill.name,
                  path: skill.path,
                  description: skill.description,
                  enabled: skill.enabled,
                })));
              },
              permissions: async () => {
                const response = await rpcAfterAttach<PermissionProfileListResponse>(session, "permissionProfile/list", { cursor: null, limit: 100, cwd });
                return response.data;
              },
              defaults: async () => {
                const response = await rpcAfterAttach<ConfigReadResponse>(session, "config/read", { cwd, includeLayers: false });
                const configuredPermissions = typeof response.config.permissions === "string"
                  ? response.config.permissions
                  : response.config.sandbox_mode === "danger-full-access"
                    ? ":danger-full-access"
                    : response.config.sandbox_mode === "workspace-write"
                      ? ":workspace"
                      : response.config.sandbox_mode === "read-only"
                        ? ":read-only"
                        : null;
                return {
                  model: response.config.model,
                  effort: response.config.model_reasoning_effort,
                  permissions: configuredPermissions,
                };
              },
            },
            (value) => resources?.putTurnControls({
              id: cacheKey,
              connectionId,
              cwd,
              status: "refreshing",
              value,
              error: null,
            }),
          );
          if (result.loadedSections === 0 && cachedValue === null) {
            throw result.errors[0] ?? new Error("Could not load model, skill, permission, or default controls");
          }
          const partialError = result.errors.length === 0
            ? null
            : `Some controls are unavailable: ${result.errors.map(errorMessage).join(" · ")}`;
          resources?.putTurnControls({ id: cacheKey, connectionId, cwd, status: "ready", value: result.value, error: partialError });
          return result.value;
        } catch (cause) {
          resources?.putTurnControls({
            id: cacheKey,
            connectionId,
            cwd,
            status: "error",
            value: cachedValue,
            error: cause instanceof Error ? cause.message : "Could not load turn controls",
          });
          throw cause;
        }
      })();
      workspaceRuntime.turnControlsInFlight.set(cacheKey, operation);
      const release = () => {
        if (workspaceRuntime.turnControlsInFlight.get(cacheKey) === operation) {
          workspaceRuntime.turnControlsInFlight.delete(cacheKey);
        }
      };
      void operation.then(release, release);
      // A durable value is usable immediately. Refresh it in the background;
      // callers should never block an already-open thread on catalog RPCs.
      if (cachedValue !== null) {
        void operation.catch(() => undefined);
        return cachedValue;
      }
      return await operation;
    };
  
    const updateThreadSettings = async (connectionId: string, threadId: string, settings: ThreadSettings) => {
      await enqueueNativeCommand(connectionId, `thread-settings-${randomUUID()}`, "thread/settings/update", { threadId, ...settings });
    };
  
    const interruptTurn = async (connectionId: string, threadId: string, turnId: string) => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      // Interrupt is an ephemeral control-plane action. Persisting it behind
      // the durable mutation outbox can make Stop wait for an unrelated turn
      // reconciliation and can replay a stale stop after reconnect.
      await rpcAfterAttach(session, "turn/interrupt", { threadId, turnId });
    };
  
    const forkThread = async (connectionId: string, threadId: string, options: ThreadForkOptions): Promise<string> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const response = await rpcAfterAttach<ThreadForkResponse>(session, "thread/fork", buildThreadForkParams(threadId, options));
      await workspaceRuntime.snapshot.threadDetails?.importThreadSnapshot(connectionId, response.thread, "fork");
      return response.thread.id;
    };
  
    const getThreadGoal = async (connectionId: string, threadId: string): Promise<ThreadGoal | null> => {
      const key = threadResourceKey(connectionId, threadId);
      const previous = workspaceRuntime.resourceDatabase.threadGoals.get(key);
      workspaceRuntime.resourceDatabase.putThreadGoal({ id: key, connectionId, threadId, status: "loading", goal: previous?.goal ?? null, error: null });
      const session = workspaceRuntime.supervisor?.session(connectionId);
      try {
        if (session === undefined) throw new Error("Connection is not enabled");
        const response = await rpcAfterAttach<ThreadGoalGetResponse>(session, "thread/goal/get", { threadId });
        workspaceRuntime.resourceDatabase.putThreadGoal({ id: key, connectionId, threadId, status: "ready", goal: response.goal, error: null });
        return response.goal;
      } catch (cause) {
        workspaceRuntime.resourceDatabase.putThreadGoal({ id: key, connectionId, threadId, status: "error", goal: previous?.goal ?? null, error: errorMessage(cause) });
        throw cause;
      }
    };
  
    const setThreadGoal = async (connectionId: string, threadId: string, input: ThreadGoalInput): Promise<ThreadGoal> => {
      const objective = input.objective.trim();
      if (objective.length < 1 || objective.length > 100_000) throw new Error("Goal objective must be 1–100000 characters");
      if (input.tokenBudget !== null && (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget < 1)) {
        throw new Error("Token budget must be a positive integer");
      }
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const response = await rpcAfterAttach<ThreadGoalSetResponse>(session, "thread/goal/set", {
        threadId,
        objective,
        status: input.status,
        tokenBudget: input.tokenBudget,
      });
      workspaceRuntime.resourceDatabase.putThreadGoal({ id: threadResourceKey(connectionId, threadId), connectionId, threadId, status: "ready", goal: response.goal, error: null });
      return response.goal;
    };
  
    const clearThreadGoal = async (connectionId: string, threadId: string): Promise<boolean> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const response = await rpcAfterAttach<{ cleared: boolean }>(session, "thread/goal/clear", { threadId });
      if (response.cleared) workspaceRuntime.resourceDatabase.putThreadGoal({ id: threadResourceKey(connectionId, threadId), connectionId, threadId, status: "ready", goal: null, error: null });
      return response.cleared;
    };
  
    const startReview = async (
      connectionId: string,
      threadId: string,
      target: ReviewTarget,
      delivery: ReviewDelivery,
    ): Promise<string> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const response = await rpcAfterAttach<ReviewStartResponse>(session, "review/start", { threadId, target, delivery });
      return response.reviewThreadId;
    };
  
    const compactThread = async (connectionId: string, threadId: string): Promise<void> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      await rpcAfterAttach(session, "thread/compact/start", { threadId });
    };

    const refreshAccountRateLimits = async (connectionId: string, force = false): Promise<GetAccountRateLimitsResponse> => {
      const database = workspaceRuntime.snapshot.accountRateLimits;
      if (database === null) throw new Error("Account limits are not ready");
      const cached = database.get(connectionId);
      if (!force && !accountRateLimitsStale(cached)) return cached!.snapshot!;
      const existing = workspaceRuntime.accountRateLimitsInFlight.get(connectionId);
      if (existing !== undefined) return await existing;
      database.markLoading(connectionId);
      const operation = (async () => {
        const session = workspaceRuntime.supervisor?.session(connectionId);
        if (session === undefined) throw new Error("Connection is not enabled");
        const accountPool = await rpcAfterAttach<AccountPoolSnapshot>(session, "companion/accountPool/refresh", {});
        database.putAccountPool(connectionId, accountPool);
        const active = accountPool.profiles.find((profile) => profile.id === accountPool.activeProfileId) ?? null;
        if (active?.rateLimits === null || active?.rateLimits === undefined || active.rateLimitsError !== null) {
          throw new Error(active?.rateLimitsError ?? "Active account limits are unavailable");
        }
        return active.rateLimits;
      })();
      workspaceRuntime.accountRateLimitsInFlight.set(connectionId, operation);
      try {
        return await operation;
      } catch (cause) {
        database.markError(connectionId, errorMessage(cause));
        throw cause;
      } finally {
        if (workspaceRuntime.accountRateLimitsInFlight.get(connectionId) === operation) {
          workspaceRuntime.accountRateLimitsInFlight.delete(connectionId);
        }
      }
    };

    const refreshAccountPool = async (connectionId: string): Promise<AccountPoolSnapshot> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const snapshot = await rpcAfterAttach<AccountPoolSnapshot>(session, "companion/accountPool/refresh", {});
      workspaceRuntime.snapshot.accountRateLimits?.putAccountPool(connectionId, snapshot);
      return snapshot;
    };

    const startAccountLogin = async (connectionId: string): Promise<AccountLoginStart> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      return await rpcAfterAttach<AccountLoginStart>(session, "companion/accountPool/add/start", {});
    };

    const cancelAccountLogin = async (connectionId: string, loginId: string): Promise<void> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      await rpcAfterAttach(session, "companion/accountPool/add/cancel", { loginId });
    };

    const activateAccountProfile = async (
      connectionId: string,
      profileId: string,
    ): Promise<AccountPoolSnapshot> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const snapshot = await rpcAfterAttach<AccountPoolSnapshot>(session, "companion/accountPool/profile/activate", { profileId });
      workspaceRuntime.snapshot.accountRateLimits?.putAccountPool(connectionId, snapshot);
      return snapshot;
    };

    const updateAccountProfile = async (
      connectionId: string,
      profileId: string,
      update: { enabled?: boolean; priority?: number },
    ): Promise<AccountPoolSnapshot> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const snapshot = await rpcAfterAttach<AccountPoolSnapshot>(session, "companion/accountPool/profile/update", { profileId, ...update });
      workspaceRuntime.snapshot.accountRateLimits?.putAccountPool(connectionId, snapshot);
      return snapshot;
    };

    const removeAccountProfile = async (connectionId: string, profileId: string): Promise<AccountPoolSnapshot> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const snapshot = await rpcAfterAttach<AccountPoolSnapshot>(session, "companion/accountPool/profile/remove", { profileId });
      workspaceRuntime.snapshot.accountRateLimits?.putAccountPool(connectionId, snapshot);
      return snapshot;
    };
  
    const createLocalhostTunnel = async (connectionId: string, port: number, ttlSeconds: number): Promise<TunnelPreview> => {
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("Port must be between 1 and 65535");
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3_600) throw new Error("TTL must be 30–3600 seconds");
      const key = tunnelResourceKey(connectionId);
      workspaceRuntime.resourceDatabase.putTunnel({ id: key, connectionId, status: "creating", tunnel: null, error: null });
      try {
        const connection = currentConnections().find((candidate) => candidate.id === connectionId);
        if (connection === undefined) throw new Error("Connection not found");
        const origin = await nativeCompanionHttpOrigin(connection.id, connection.endpoint);
        const controlUrl = companionHttpUrl(origin, "/v1/tunnels");
        const authorization = await scopedHttpAuthorization(connection);
        const response = await fetch(controlUrl, {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({ port, ttlSeconds }),
        });
        if (!response.ok) throw new Error(`Tunnel creation failed (${response.status})`);
        const body = await response.json() as { id: string; expiresAt: number; basePath: string };
        const tunnel = { id: body.id, expiresAt: body.expiresAt, url: companionHttpUrl(origin, body.basePath), authorization };
        workspaceRuntime.resourceDatabase.putTunnel({ id: key, connectionId, status: "ready", tunnel, error: null });
        return tunnel;
      } catch (cause) {
        workspaceRuntime.resourceDatabase.putTunnel({ id: key, connectionId, status: "error", tunnel: null, error: errorMessage(cause) });
        throw cause;
      }
    };
  
    const revokeLocalhostTunnel = async (connectionId: string, tunnelId: string): Promise<void> => {
      const connection = currentConnections().find((candidate) => candidate.id === connectionId);
      if (connection === undefined) return;
      const key = tunnelResourceKey(connectionId);
      const current = workspaceRuntime.resourceDatabase.tunnels.get(key)?.tunnel ?? null;
      workspaceRuntime.resourceDatabase.putTunnel({ id: key, connectionId, status: "revoking", tunnel: current, error: null });
      try {
        const authorization = await scopedHttpAuthorization(connection);
        const origin = await nativeCompanionHttpOrigin(connection.id, connection.endpoint);
        const response = await fetch(companionHttpUrl(origin, `/v1/tunnels/${encodeURIComponent(tunnelId)}`), {
          method: "DELETE",
          headers: { authorization },
        });
        if (!response.ok && response.status !== 404) throw new Error(`Tunnel revoke failed (${response.status})`);
        workspaceRuntime.resourceDatabase.putTunnel({ id: key, connectionId, status: "ready", tunnel: null, error: null });
      } catch (cause) {
        workspaceRuntime.resourceDatabase.putTunnel({ id: key, connectionId, status: "error", tunnel: current, error: errorMessage(cause) });
        throw cause;
      }
    };
  
    const respondToServerRequest = async (request: PendingServerRequest, result: unknown): Promise<void> => {
      const pending = workspaceRuntime.snapshot.pendingRequests;
      if (pending === null || !pending.claim(request.connectionId, request.requestKey)) return;
      try {
        const requestHash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, request.requestKey);
        await enqueueNativeCommand(
          request.connectionId,
          `server-response-${requestHash}`,
          "serverRequest/respond",
          { requestId: request.requestId, result },
        );
      } catch (cause) {
        pending.release(request.connectionId, request.requestKey);
        throw cause;
      }
    };
  
    const transferAccess = async (connectionId: string, forceRefresh = false): Promise<TransferAccess> => {
      const connection = currentConnections().find((candidate) => candidate.id === connectionId);
      if (connection === undefined) throw new Error("Connection not found");
      const origin = await nativeCompanionHttpOrigin(connection.id, connection.endpoint);
      return { baseUrl: companionHttpUrl(origin, "/"), authorization: await scopedHttpAuthorization(connection, forceRefresh) };
    };

  return {
    retryStartup,
    startVoiceTranscription,
    addConnection,
    deleteConnection,
    setConnectionEnabled,
    reconnectConnection,
    updateConnectionProfile,
    updateConnection,
    moveConnection,
    searchThreads,
    listProjects,
    addProject,
    readDirectory,
    inspectWorkspace,
    createWorkspace,
    startThreadInWorkspace,
    setThreadPinned,
    startThread,
    renameThread,
    archiveThread,
    unarchiveThread,
    deleteThread,
    markThreadRead,
    loadDraft,
    saveDraft,
    loadDraftAttachments,
    saveDraftAttachments,
    loadScrollOffset,
    saveScrollOffset,
    loadComposerPreferences,
    saveComposerPreferences,
    listQueuedPrompts,
    editQueuedPrompt,
    cancelQueuedPrompt,
    moveQueuedPrompt,
    steerQueuedPrompt,
    listBackgroundTerminals,
    terminateBackgroundTerminal,
    readThread,
    observeThread,
    repairThreadProjection,
    refreshThreadCatalog,
    refreshSubagents,
    loadThreadResources,
    loadThreadChangeDiff,
    loadOlderTurns,
    loadTurnItems,
    sendText,
    retryFailedMessage,
    loadTurnControls,
    updateThreadSettings,
    interruptTurn,
    forkThread,
    getThreadGoal,
    setThreadGoal,
    clearThreadGoal,
    startReview,
    compactThread,
    refreshAccountRateLimits,
    refreshAccountPool,
    startAccountLogin,
    cancelAccountLogin,
    activateAccountProfile,
    updateAccountProfile,
    removeAccountProfile,
    createLocalhostTunnel,
    revokeLocalhostTunnel,
    respondToServerRequest,
    transferAccess,
  };
}

const workspaceActions = createWorkspaceActions();

function refreshInvalidatedThread(connectionId: string, threadId: string, archived: boolean, turnActive: boolean): void {
  const key = `${connectionId}\u0000${threadId}`;
  workspaceRuntime.threadInvalidationGeneration.set(
    key,
    (workspaceRuntime.threadInvalidationGeneration.get(key) ?? 0) + 1,
  );
  workspaceRuntime.threadInvalidationArchived.set(key, archived);
  workspaceRuntime.threadInvalidationActive.set(key, turnActive);
  if (workspaceRuntime.threadInvalidationRefreshInFlight.has(key)) return;

  const operation = (async (): Promise<void> => {
    while (true) {
      const generation = workspaceRuntime.threadInvalidationGeneration.get(key) ?? 0;
      const known = (await workspaceRuntime.snapshot.threadSummaries?.get(connectionId, threadId) ?? null) !== null;
      const cached = workspaceRuntime.snapshot.threadDetails?.getThread(connectionId, threadId) ?? null;
      // Existing cold rows already receive the bounded semantic preview patch.
      // Never overwrite a known live chain with the lossy active rollout
      // summary. Unknown external threads still need one read to materialize.
      if (shouldRefreshInvalidatedThread(
        known,
        cached !== null,
        workspaceRuntime.threadInvalidationActive.get(key) === true,
      )) {
        await workspaceActions.readThread(connectionId, threadId, cached);
      }
      if ((workspaceRuntime.threadInvalidationGeneration.get(key) ?? 0) === generation) break;
    }
  })().catch((cause: unknown) => {
    console.warn(
      "CodeWide external thread refresh failed:",
      cause instanceof Error ? cause.message : "unknown error",
    );
  }).finally(() => {
    workspaceRuntime.threadInvalidationRefreshInFlight.delete(key);
    workspaceRuntime.threadInvalidationGeneration.delete(key);
    workspaceRuntime.threadInvalidationArchived.delete(key);
    workspaceRuntime.threadInvalidationActive.delete(key);
  });
  workspaceRuntime.threadInvalidationRefreshInFlight.set(key, operation);
}

export function useRemoteWorkspace(): RemoteWorkspace {
  const native = workspaceRuntime.native;
  const runtime = useSyncExternalStore(
    workspaceRuntime.subscribe,
    workspaceRuntime.getSnapshot,
    workspaceRuntime.getSnapshot,
  );
  const {
    ready,
    error,
    connectionProfiles: connectionProfileDatabase,
    connectionState: connectionStateModel,
    threadSummaries: threadDatabase,
    threadDetails,
    pendingRequests: pendingRequestDatabase,
  } = runtime;
  const connectionStateRows = useSelector(() => connectionStateModel?.rows$.get() ?? []);
  const connectionProfileQuery = useLiveQuery(
    () => connectionProfileDatabase?.collection,
    [connectionProfileDatabase],
  );
  const connectionProfiles = connectionProfileDatabase?.project(connectionProfileQuery.data === undefined ? undefined : [...connectionProfileQuery.data]) ?? [];
  const connections = (() => {
    const states = new Map(connectionStateRows.map((row) => [row.connectionId, row]));
    return connectionProfiles.map((profile) => {
      const state = states.get(profile.id);
      return state === undefined ? {
        ...profile,
        state: profile.enabled ? "connecting" as const : "offline" as const,
        lastError: null,
        lastErrorAt: null,
      } : {
        ...profile,
        // `live` is a user-visible claim that foreground RPC is available. The
        // native engine publishes both axes; never promote a stale or partial
        // transport state to Live when it cannot serve a request.
        state: connectionDisplayState(state),
        lastError: state.lastError,
        lastErrorAt: state.lastErrorAt,
      };
    });
  })();
  const pendingRequestQuery = useLiveQuery(
    () => pendingRequestDatabase?.collection,
    [pendingRequestDatabase],
  );
  const pendingRequests = [...(pendingRequestQuery.data ?? [])].sort((left, right) => left.createdAt - right.createdAt);
  return {
    native,
    ready,
    error,
    connections,
    threadSummaryDatabase: threadDatabase,
    threadUiStateDatabase: runtime.threadUiState,
    resourceDatabase: runtime.resources,
    accountRateLimitsDatabase: runtime.accountRateLimits,
    voiceController: workspaceRuntime.voiceController,
    fileTransferController: workspaceRuntime.fileTransferController,
    pendingRequests,
    threadDetails,
    ...workspaceActions,
  };
}

function ensureWorkspaceRuntimeStarted(): Promise<void> {
  if (!workspaceRuntime.native) return Promise.resolve();
  if (workspaceRuntime.startPromise !== null) return workspaceRuntime.startPromise;
  workspaceRuntime.startPromise = startWorkspaceRuntime().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : "unknown startup error";
    workspaceRuntime.update({ ready: true, error: message });
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
    details.setRemoteLoader({
      observe({ connectionId, threadId }) {
        void workspaceActions.observeThread(connectionId, threadId).catch((cause: unknown) => {
          console.warn("Could not attach retained thread observer", cause);
        });
      },
      async reconcilePending({ connectionId, threadId }) {
        await reconcileActiveThreadCommands(details, connectionId, threadId);
      },
      async hydrateWindow({ request, cachedThread, requireAuthoritative }) {
        await workspaceActions.readThread(
          request.connectionId,
          request.threadId,
          cachedThread,
          requireAuthoritative,
          shouldUseBoundedThreadWindowRead(cachedThread !== null),
        );
      },
      async loadOlder({ connectionId, threadId, cursor, historyEpoch }) {
        await workspaceActions.loadOlderTurns(connectionId, threadId, cursor, historyEpoch);
      },
    });
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
      ready: false,
      error: null,
      connectionProfiles: profiles,
      connectionState,
      threadSummaries: summaries,
      threadDetails: details,
      pendingRequests,
      threadUiState,
      resources,
      accountRateLimits,
    });
    summaries.setRenameHandler(async (connectionId, threadId, name) => {
      await enqueueNativeCommand(connectionId, `thread-name-${randomUUID()}`, "thread/name/set", { threadId, name });
    });
    await Promise.all([
      summaries.prepare(),
      details.prepare(),
      profiles.collection.preload(),
      pendingRequests.collection.preload(),
      threadUiState.collection.preload(),
      resources.turnControls.preload(),
      accountRateLimits.collection.preload(),
    ]);
    // Kotlin owns the only durable command ledger. The UI cache is a reconstructable
    // read model, so startup reads the native snapshot only for state that is
    // already active (thread deletion) and never persists a second outbox copy.
    try {
      await summaries.reconcileDeleteCommands(await listNativeCommands());
    } catch (cause) {
      console.warn("Could not reconcile native command state during startup", cause);
    }

    startupStage = "profile migration";
    let initialProfiles = await profiles.hydrate();
    const profileStorageMigrationComplete = await SecureStore.getItemAsync(CONNECTION_PROFILE_STORAGE_MIGRATION_KEY) === "1";
    if (!profileStorageMigrationComplete) {
      try {
        await profiles.importLegacyUiCache();
        initialProfiles = await profiles.hydrate();
      } catch (cause) {
        // Native credentials below still recover the functional server list.
        // Cosmetic metadata from a corrupt obsolete cache is best-effort only.
        console.warn("Could not migrate server profile metadata from the old UI cache", cause);
      }
      await SecureStore.setItemAsync(CONNECTION_PROFILE_STORAGE_MIGRATION_KEY, "1", {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    }
    const connectionMigrationComplete = await SecureStore.getItemAsync(CONNECTION_PROFILE_MIGRATION_KEY) === "1";
    if (!connectionMigrationComplete) {
      if (initialProfiles.length === 0) {
        const legacyStore = await LegacyRemoteStore.open();
        try {
          await profiles.importLegacy(await legacyStore.listConnections());
        } finally {
          await legacyStore.close();
        }
        initialProfiles = await profiles.hydrate();
      }
      await SecureStore.setItemAsync(CONNECTION_PROFILE_MIGRATION_KEY, "1", {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    }
    const nativeCredentialMigrationComplete = await SecureStore.getItemAsync(NATIVE_CREDENTIAL_MIGRATION_KEY) === "1";
    if (!nativeCredentialMigrationComplete) {
      for (const connection of initialProfiles) {
        if (connection.token.length === 0) continue;
        await saveNativeConnectionCredentials({
          connectionId: connection.id,
          endpoint: connection.endpoint,
          token: connection.token,
          enabled: connection.enabled,
          ...(connection.tlsPinSha256 === undefined ? {} : { tlsPinSha256: connection.tlsPinSha256 }),
        });
      }
      await profiles.migrateLegacyCredentials(async (connection) => {
        await saveNativeConnectionCredentials({
          connectionId: connection.id,
          endpoint: connection.endpoint,
          token: connection.token,
          enabled: connection.enabled,
          ...(connection.tlsPinSha256 === undefined ? {} : { tlsPinSha256: connection.tlsPinSha256 }),
        });
      });
      await SecureStore.setItemAsync(NATIVE_CREDENTIAL_MIGRATION_KEY, "1", {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    }

    startupStage = "native credential projection";
    const nativeConfigs = await listNativeConnectionConfigs();
    await profiles.purgeLegacyCredentials(nativeConfigs.map((config) => config.connectionId));
    await profiles.reconcileRuntimeConfigs(nativeConfigs);
    initialProfiles = await profiles.hydrate();
    try {
      const reclaimedBytes = await purgeLegacyDerivedStorage();
      if (__DEV__ && reclaimedBytes > 0) {
        console.info(`Removed ${reclaimedBytes} bytes of obsolete local cache data`);
      }
    } catch (cause) {
      // Cleanup is deliberately non-fatal and retried on the next launch. A
      // locked old WAL must never prevent the server-backed cache from loading.
      console.warn("Could not remove obsolete local cache databases", cause);
    }
    const projection = createThreadProjectionStore({
      summaries,
      details,
      async reconcileBeforeSummary(connectionId, events, projected) {
        const proofs = terminalProjectionProofs(events);
        const repairThreadIds = streamRepairThreadIds(events, projected.threads);
        if (repairThreadIds.length === 0) return projected;
        const threads = new Map(projected.threads);
        const terminalThreadIds = new Set(events.flatMap((event) => {
          const patch = threadProjectionPatchFromEvent(event.payload);
          return patch?.operation.kind === "turnCompleted" ? [patch.threadId] : [];
        }));
        for (const threadId of repairThreadIds) {
          const repaired = await workspaceActions.repairThreadProjection(
            connectionId,
            threadId,
            terminalThreadIds.has(threadId),
          );
          if (repaired === null) throw new Error(`Authoritative stream repair returned no thread for ${threadId}`);
          for (const proof of proofs.filter((candidate) => candidate.threadId === threadId)) {
            if (terminalProjectionMatches(repaired.thread, proof)) continue;
            // The canonical indexed head has already been durably projected.
            // A witness mismatch is integrity telemetry, not a reason to reject
            // and replay a deterministic cursor forever.
            incrementMetric("stream_repair_mismatches");
            recordTelemetryEvent(connectionId, {
              name: "stream.authoritative_repair_mismatch",
              sessionId: threadId,
              threadId,
              turnId: proof.turnId,
              tags: { witness: "agent_message_hash" },
            });
            console.warn(`Authoritative stream repair witness mismatch for ${threadId}`);
          }
          const before = projected.threads.get(threadId)?.before ?? repaired.thread;
          threads.set(threadId, { before, after: repaired.thread });
        }
        incrementMetric("stream_repairs", repairThreadIds.length);
        return { checkpoint: projected.checkpoint, threads };
      },
    });

    startupStage = "connection engine";
    const nativeSupervisorOptions: ConstructorParameters<typeof NativeEngineSupervisor>[0] = {
      connectionState: {
        setConnectionState(connectionId, state, diagnostic, rpcAvailable) {
          connectionState.setState(connectionId, state, diagnostic, rpcAvailable);
        },
      },
      projection: {
        async applySnapshot(connectionId, snapshots, cursor) {
          await projection.applySnapshot(connectionId, snapshots, cursor);
          workspaceRuntime.threadCatalogRefreshedAt.set(connectionId, Date.now());
          await reconcileDeliveredCommandReceipts(
            connectionId,
            snapshots.map(({ thread }) => thread),
          );
        },
        async applyEvents(connectionId, events) {
          const projected = await projection.applyEvents(connectionId, events);
          const projectedThreads = new Map([...projected.threads].map(([threadId, thread]) => [threadId, thread.after]));
          const receiptThreadIds = new Set<string>();
          const deliveredReceiptThreads = new Set<string>();
          const subagentRoots = new Set<string>();
          for (const event of events) {
            const params = asRecord(event.payload.params);
            const patch = threadProjectionPatchFromEvent(event.payload);
            if (event.payload.method === "account/rateLimits/updated" && params !== null) {
              accountRateLimits.mergeUpdate(connectionId, params as AccountRateLimitsUpdatedNotification);
            }
            if (event.payload.method === "companion/accountPool/updated" && params !== null) {
              accountRateLimits.putAccountPool(connectionId, params as AccountPoolSnapshot);
            }
            if (event.payload.method === "companion/queue/changed" && params !== null && typeof params.threadId === "string") {
              const queueThreadId = params.threadId;
              const commands = parseHostQueueSnapshot(params.data);
              if (commands !== null) {
                // A host acceptance receipt starts bounded canonical repair,
                // but does not retire the durable optimistic row. Only the
                // matching stable client id in thread history owns that handoff.
                await details.replaceQueued(connectionId, queueThreadId, commands);
                const appServerAcceptedPendingDelivery = hasAppServerAcceptedPendingDelivery(
                  commands,
                  (commandId) => details.hasPendingDelivery(connectionId, queueThreadId, commandId),
                );
                if (appServerAcceptedPendingDelivery) deliveredReceiptThreads.add(queueThreadId);
              }
            }
            if (patch?.operation.kind === "threadInvalidated") {
              refreshInvalidatedThread(
                connectionId,
                patch.threadId,
                patch.operation.archived === true,
                patch.operation.turnActive === true,
              );
            }
            const subagentRoot = subagentActivityRootThreadId(event.payload);
            if (subagentRoot !== null) subagentRoots.add(subagentRoot);
            const threadId = threadIdFromEvent(event.payload);
            if (threadId === null) continue;
            if (patch !== null) {
              if (operationConfirmsDeliveredCommand(patch.operation)) receiptThreadIds.add(threadId);
              const key = threadResourceKey(connectionId, threadId);
              const current = workspaceRuntime.resourceDatabase.threadResources.get(key);
              const cwd = projectedThreads.get(threadId)?.cwd;
              if (current?.value !== null && current?.value !== undefined && typeof cwd === "string") {
                const value = projectThreadResourcePatch(current.value, cwd, patch, event.cursor);
                if (value !== current.value) workspaceRuntime.resourceDatabase.putThreadResources({
                  id: key,
                  connectionId,
                  threadId,
                  status: current.status,
                  value,
                  error: current.error,
                  ...(current.pendingKinds === undefined ? {} : { pendingKinds: current.pendingKinds }),
                  ...(current.readyKinds === undefined ? {} : { readyKinds: current.readyKinds }),
                  ...(current.resourceErrors === undefined ? {} : { resourceErrors: current.resourceErrors }),
                });
              }
            }
          }
          await reconcileDeliveredCommandReceipts(
            connectionId,
            [...receiptThreadIds].flatMap((threadId) => {
              const thread = projectedThreads.get(threadId);
              return thread === undefined ? [] : [thread];
            }),
          );
          for (const threadId of deliveredReceiptThreads) {
            // `queue/changed: delivered` should be followed by the canonical
            // `turn/started` frame. Do not put an authoritative network read in
            // the ordered projection lane: doing so holds that lifecycle frame
            // (and the visible Running state) behind thread/resume. The repair
            // remains a fallback for a genuinely missed canonical frame, but
            // it runs independently of live event publication.
            void workspaceActions.repairThreadProjection(connectionId, threadId).then(async (repaired) => {
              if (repaired === null) throw new Error(`Accepted message receipt repair returned no thread for ${threadId}`);
              await reconcileDeliveredCommandReceipts(connectionId, [repaired.thread]);
            }).catch((cause: unknown) => {
              console.warn("Accepted message receipt background repair failed:", cause instanceof Error ? cause.message : "unknown error");
            });
          }
          for (const rootThreadId of subagentRoots) {
            void workspaceActions.refreshSubagents(connectionId, rootThreadId, true).catch((cause: unknown) => {
              console.warn("CodeWide subagent event refresh failed:", cause instanceof Error ? cause.message : "unknown error");
            });
          }
          return projected;
        },
      },
      onPendingRequests: (connectionId, requests) => pendingRequests.replace(connectionId, requests),
      onOutboxChange: (delivery) => {
        void details.applyCommandDelivery(delivery).catch((cause: unknown) => {
          console.error("Timeline delivery projection failed", cause);
        });
        void summaries.applyCommandDelivery(delivery).catch((cause: unknown) => {
          console.error("Thread delete projection failed", cause);
        });
      },
    };
    const supervisor: WorkspaceSyncSupervisor = new NativeEngineSupervisor(nativeSupervisorOptions);
    workspaceRuntime.supervisor = supervisor;
    connectionState.reconcileProfiles(initialProfiles.map((connection) => ({
      id: connection.id,
      connectionId: connection.id,
      enabled: connection.enabled,
    })));
    supervisor.replaceConnections(initialProfiles);
    workspaceRuntime.profileSubscription?.unsubscribe();
    workspaceRuntime.profileSubscription = profiles.collection.subscribeChanges(() => {
      const currentProfiles = profiles.project();
      connectionState.reconcileProfiles(currentProfiles.map(connectionStateSeed));
      supervisor.replaceConnections(currentProfiles);
    });
    workspaceRuntime.connectionStateSubscription?.unsubscribe();
    workspaceRuntime.connectionStateSubscription = connectionState.subscribeChanges((row) => {
        recordConnectionUsability(row);
        if (row.state === "live" && row.rpcAvailable) {
          const desiredThreadId = workspaceRuntime.threadObserverDesired.get(row.connectionId);
          if (desiredThreadId !== undefined) {
            // A Companion or App Server restart drops observer state while the
            // selected mobile route stays mounted. Reattach the desired thread
            // on every new live generation instead of waiting for another tap.
            workspaceRuntime.threadObserverAttachInFlight.delete(`${row.connectionId}\u0000${desiredThreadId}`);
            void workspaceActions.observeThread(row.connectionId, desiredThreadId).catch((cause: unknown) => {
              console.warn("Thread observer reattach failed after reconnect", cause);
            });
          }
          void workspaceActions.refreshThreadCatalog(row.connectionId).catch((cause: unknown) => {
            console.warn("Thread catalog repair failed after connection became live", cause);
          });
          if (accountRateLimitsStale(accountRateLimits.get(row.connectionId))) {
            void workspaceActions.refreshAccountRateLimits(row.connectionId).catch(() => undefined);
          }
        }
    }, { includeInitialState: true });
    workspaceRuntime.update({
      ready: true,
      error: null,
      connectionProfiles: profiles,
      connectionState,
      threadSummaries: summaries,
      threadDetails: details,
      pendingRequests,
      threadUiState,
      resources,
      accountRateLimits,
    });
    const repairCatalogs = (): void => {
      for (const connectionId of workspaceRuntime.enabledConnectionIds()) {
        wakeNativeConnection(connectionId);
        void workspaceActions.refreshThreadCatalog(connectionId).catch((cause: unknown) => {
          console.warn("Thread catalog lifecycle repair failed", cause);
        });
      }
    };
    for (const subscription of workspaceRuntime.catalogLifecycleSubscriptions) subscription.remove();
    workspaceRuntime.catalogLifecycleSubscriptions = [
      AppState.addEventListener("focus", repairCatalogs),
      AppState.addEventListener("change", (state) => {
        if (state === "active") repairCatalogs();
      }),
    ];
    if (workspaceRuntime.catalogRepairTimer !== null) clearInterval(workspaceRuntime.catalogRepairTimer);
    workspaceRuntime.catalogRepairTimer = setInterval(() => {
      if (AppState.currentState === "active") repairCatalogs();
    }, THREAD_CATALOG_REPAIR_TICK_MS);
    repairCatalogs();
  } catch (cause) {
    if (createdThreadDetails !== null) {
      if (workspaceRuntime.snapshot.threadDetails === createdThreadDetails) {
        workspaceRuntime.update({ threadDetails: null });
      }
      try {
        await createdThreadDetails.close();
      } catch (closeCause) {
        console.warn("Could not close failed thread detail startup", closeCause);
      }
    }
    const message = cause instanceof Error ? cause.message : "unknown startup error";
    throw new Error(`Local runtime startup failed (${startupStage}): ${message}`, { cause });
  }
}

function connectionStateSeed(connection: StoredConnection) {
  return {
    id: connection.id,
    connectionId: connection.id,
    enabled: connection.enabled,
  };
}

function recordConnectionUsability(connection: { connectionId: string; state: RemoteConnectionState; rpcAvailable: boolean }): void {
  const effectiveState = connectionDisplayState(connection);
  if (effectiveState === "connecting") {
    if (!workspaceRuntime.connectionAttemptStartedAt.has(connection.connectionId)) {
      workspaceRuntime.connectionAttemptStartedAt.set(connection.connectionId, performance.now());
    }
    return;
  }
  if (effectiveState !== "syncing" && effectiveState !== "live") return;
  const startedAt = workspaceRuntime.connectionAttemptStartedAt.get(connection.connectionId);
  if (startedAt === undefined) return;
  const elapsed = performance.now() - startedAt;
  workspaceRuntime.connectionAttemptStartedAt.delete(connection.connectionId);
  recordTiming("connection_to_usable_ms", elapsed);
  if (__DEV__) console.log(`[CodeWide perf] connection_to_usable_ms=${Math.round(elapsed)} connection=${connection.connectionId}`);
}

function requireThreadUiStateDatabase(database: ThreadUiStateDatabase | null): ThreadUiStateDatabase {
  if (database === null) throw new Error("Local thread UI state is not ready");
  return database;
}

function requireConnectionProfileDatabase(database: ConnectionProfileDatabase | null): ConnectionProfileDatabase {
  if (database === null) throw new Error("Local connection profiles are not ready");
  return database;
}

function requireThreadSummaryDatabase(database: ThreadSummaryDatabase | null): ThreadSummaryDatabase {
  if (database === null) throw new Error("Local thread summaries are not ready");
  return database;
}

async function getOrCreateThreadUiState(
  connectionId: string,
  threadId: string,
  database: ThreadUiStateDatabase | null,
  inFlight: Map<string, ReturnType<ThreadUiStateDatabase["getOrCreate"]>>,
) {
  const uiState = requireThreadUiStateDatabase(database);
  const cached = uiState.get(connectionId, threadId);
  if (cached !== null) return cached;
  const key = `${connectionId}\u0000${threadId}`;
  const pending = inFlight.get(key);
  if (pending !== undefined) return await pending;
  const operation = uiState.getOrCreate(connectionId, threadId);
  inFlight.set(key, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(key) === operation) inFlight.delete(key);
  }
}

async function rpcAfterAttach<T>(session: RpcClient, method: string, params: unknown): Promise<T> {
  const connectionId = session.connectionId;
  if (connectionId === undefined) return await session.rpc<T>(method, params);
  const paramsRecord = asRecord(params);
  const requestId = typeof paramsRecord?.requestId === "string" && paramsRecord.requestId.length > 0
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
      tags: { method, phase: "failed", errorKind: cause instanceof RpcResponseError ? "rpc" : "transport" },
    });
    throw cause;
  }
}

const AUDIO_UPLOAD_RETRY_BASE_MS = 250;
const AUDIO_UPLOAD_RETRY_MAX_MS = 5_000;
const DICTATION_FINISH_TRANSPORT_RETRIES = 3;

async function finishDictationWithTransportRetry(session: RpcClient, sessionId: string): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (session.waitUntilLive !== undefined) await session.waitUntilLive(30_000);
      return await rpcAfterAttach(session, "companion/dictation/finish", { sessionId });
    } catch (cause) {
      const transientRpc = cause instanceof RpcResponseError && (cause.code === -32003 || cause.code === -32004);
      if ((cause instanceof RpcResponseError && !transientRpc) || attempt >= DICTATION_FINISH_TRANSPORT_RETRIES) throw cause;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(2_000, AUDIO_UPLOAD_RETRY_BASE_MS * (2 ** attempt))));
    }
  }
}

async function sendDictationBatchUntilAccepted(
  session: RpcClient,
  params: unknown,
  signal: AbortSignal,
): Promise<void> {
  let attempt = 0;
  while (true) {
    throwIfAudioUploadAborted(signal);
    try {
      if (session.waitUntilLive !== undefined) {
        await raceAudioUploadAbort(session.waitUntilLive(30_000), signal);
      }
      await raceAudioUploadAbort(rpcAfterAttach(session, "companion/dictation/appendBatch", params), signal);
      return;
    } catch (cause) {
      throwIfAudioUploadAborted(signal);
      // Companion validation/auth failures are deterministic. Transport loss,
      // reconnect windows and host backpressure are not: keep the same
      // idempotent batch queued and retry until the host acknowledges it.
      if (cause instanceof RpcResponseError && cause.code !== -32003 && cause.code !== -32004) throw cause;
      const delayMs = Math.min(AUDIO_UPLOAD_RETRY_MAX_MS, AUDIO_UPLOAD_RETRY_BASE_MS * (2 ** Math.min(attempt, 5)));
      attempt += 1;
      await waitForAudioUploadRetry(delayMs, signal);
    }
  }
}

function throwIfAudioUploadAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Audio upload cancelled");
  error.name = "AbortError";
  throw error;
}

async function raceAudioUploadAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAudioUploadAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      const error = new Error("Audio upload cancelled");
      error.name = "AbortError";
      reject(error);
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (cause: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(cause);
      },
    );
  });
}

async function waitForAudioUploadRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  await raceAudioUploadAbort(new Promise<void>((resolve) => setTimeout(resolve, delayMs)), signal);
}

async function loadTurnItemsFromFullTurns(session: RpcClient, threadId: string, turnId: string): Promise<Turn["items"]> {
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  do {
    const page: ThreadTurnsListResponse = await rpcAfterAttach<ThreadTurnsListResponse>(session, "thread/turns/list", {
      threadId,
      cursor,
      // This fallback exists for app-server builds that expose
      // thread/items/list in the schema but reject it at runtime. Never fetch a
      // whole history page with full tool output: one diff-heavy page can be
      // many megabytes and starve every other RPC on the shared socket.
      limit: 2,
      sortDirection: "desc",
      itemsView: "full",
    });
    const turn = page.data.find((candidate) => candidate.id === turnId);
    if (turn !== undefined) return turn.items;
    if (page.nextCursor === null) break;
    if (seenCursors.has(page.nextCursor)) throw new Error("Server returned a repeated turn cursor");
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (true);
  throw new Error("Turn activity is no longer available");
}

function rpcResponseErrorCode(cause: unknown): number | null {
  if (cause instanceof RpcResponseError) return cause.code;
  if (cause === null || typeof cause !== "object" || !("code" in cause)) return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

function residentThreadWindow(thread: Thread, limit = THREAD_RESIDENT_TURN_LIMIT): Thread {
  if (thread.turns.length <= limit) return thread;
  return { ...thread, turns: thread.turns.slice(-limit) };
}

function companionHttpUrl(endpoint: string, path: string): string {
  const url = new URL(endpoint);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function reconcileDeliveredCommandReceipts(
  connectionId: string,
  threads: readonly Thread[],
): Promise<void> {
  if (threads.length === 0) return;
  let nativeCommands: NativeCommandDelivery[];
  try {
    nativeCommands = await listNativeCommands();
  } catch (cause) {
    console.warn("Could not inspect native receipts after authoritative projection", cause);
    return;
  }
  const rows = nativeCommands.filter((delivery) => (
    delivery.connectionId === connectionId
      && delivery.state === "delivered"
      && (delivery.method === "turn/start" || delivery.method === "turn/steer")
      && delivery.threadId !== null
  ));
  if (rows.length === 0) return;

  const rowsByThread = new Map<string, NativeCommandDelivery[]>();
  for (const delivery of rows) {
    const threadId = delivery.threadId;
    if (threadId === null) continue;
    const current = rowsByThread.get(threadId);
    if (current === undefined) rowsByThread.set(threadId, [delivery]);
    else current.push(delivery);
  }

  const accepted = new Set<string>();
  for (const thread of threads) {
    const receipts = rowsByThread.get(thread.id);
    if (receipts === undefined) continue;
    const clientIds = new Set(thread.turns.flatMap((turn) => turn.items.flatMap((item) =>
      item.type === "userMessage" && typeof item.clientId === "string" && item.clientId.length > 0
        ? [item.clientId]
        : [],
    )));
    for (const delivery of receipts) {
      if (clientIds.has(delivery.commandId)) accepted.add(delivery.commandId);
    }
  }

  await Promise.all([...accepted].map(async (commandId) => {
    try {
      await acknowledgeNativeCommandReceipt(connectionId, commandId);
    } catch (cause) {
      // The authoritative projection already contains the prompt, so a native
      // receipt cleanup failure must not block frame acknowledgement or render
      // the duplicate again. The bounded native receipt can be retried later.
      console.warn("Native command receipt acknowledgement failed", cause);
    }
  }));
}

async function reconcileActiveThreadCommands(
  details: ThreadDetailDatabase | null,
  connectionId: string,
  threadId: string,
): Promise<boolean> {
  if (details === null) return false;
  try {
    const deliveries = await listNativeCommands();
    await details.reconcileNativeCommands(connectionId, threadId, deliveries);
    return hasUnresolvedDeliveredCommand(
      deliveries,
      connectionId,
      threadId,
      (commandId) => details.hasPendingDelivery(connectionId, threadId, commandId),
    );
  } catch (cause) {
    // The native ledger is authoritative and remains available for the next
    // active-thread refresh. A read-model repair must not make history fail.
    console.warn("Could not reconcile the active thread from the native outbox", cause);
    return false;
  }
}

async function runOptimisticPendingMutation(
  details: ThreadDetailDatabase,
  mutation: PendingTimelineMutation,
  persistNative: () => Promise<void>,
): Promise<void> {
  const optimistic = details.stagePendingMutation(mutation);
  try {
    // The optimistic layer may roll back only before Kotlin has durably
    // accepted the command. After that point the native outbox owns recovery.
    await commitNativeThenProject(persistNative, async () => {
      const projected = await details.commitPendingMutation(mutation);
      if (!projected) console.warn("Accepted queue mutation will be reconciled from the native outbox");
    });
    optimistic.complete();
  } catch (cause) {
    optimistic.rollback();
    throw cause;
  }
}

type ThreadResourceLoadKind = "all" | "changes" | "attachments";

type ThreadResourcesPatch = Pick<ThreadResourcesValue, "threadId" | "revision"> & {
  changeScope?: ThreadResourcesValue["changeScope"];
  changeScopes?: ThreadResourcesValue["changeScopes"];
  changes?: ThreadResourcesValue["changes"];
  attachments?: ThreadResourcesValue["attachments"];
};

function parseThreadResourcesPatch(value: unknown, expectedThreadId: string, kind: ThreadResourceLoadKind): ThreadResourcesPatch {
  const source = asRecord(value);
  if (source === null || source.threadId !== expectedThreadId || typeof source.revision !== "string") {
    throw new Error("Companion returned invalid thread resources");
  }
  const changes = Array.isArray(source.changes) ? source.changes.slice(0, 5_000).flatMap((entry) => {
    const item = asRecord(entry);
    if (
      item === null
      || typeof item.path !== "string"
      || (item.kind !== "add" && item.kind !== "delete" && item.kind !== "update")
      || typeof item.additions !== "number"
      || typeof item.deletions !== "number"
      || typeof item.turnId !== "string"
      || typeof item.itemId !== "string"
    ) return [];
    return [{
      path: item.path,
      kind: item.kind as ThreadResourcesValue["changes"][number]["kind"],
      availability: parseChangeAvailability(item.availability, item.kind),
      additions: Math.max(0, Math.trunc(item.additions)),
      deletions: Math.max(0, Math.trunc(item.deletions)),
      binary: item.binary === true,
      turnId: item.turnId,
      itemId: item.itemId,
    }];
  }) : [];
  const attachments = Array.isArray(source.attachments) ? source.attachments.slice(0, 5_000).flatMap((entry) => {
    const item = asRecord(entry);
    if (
      item === null
      || typeof item.key !== "string"
      || typeof item.name !== "string"
      || (item.kind !== "image" && item.kind !== "audio" && item.kind !== "file")
      || (item.path !== null && typeof item.path !== "string")
      || (item.url !== null && typeof item.url !== "string")
      || (item.origin !== "user" && item.origin !== "agent")
      || typeof item.turnId !== "string"
      || typeof item.itemId !== "string"
    ) return [];
    return [{
      key: item.key,
      name: item.name,
      kind: item.kind as ThreadResourcesValue["attachments"][number]["kind"],
      path: item.path,
      url: item.url,
      origin: item.origin as ThreadResourcesValue["attachments"][number]["origin"],
      turnId: item.turnId,
      itemId: item.itemId,
    }];
  }) : [];
  const changeScope = parseThreadChangeScope(source.changeScope) ?? (kind === "attachments" ? null : "session");
  const changeScopes = changeScope === null
    ? null
    : Array.isArray(source.changeScopes)
    ? source.changeScopes.flatMap((scope) => {
        const parsed = parseThreadChangeScope(scope);
        return parsed === null ? [] : [parsed];
      }).filter((scope, index, scopes) => scopes.indexOf(scope) === index)
    : [changeScope];
  if (changeScope !== null && changeScopes !== null && !changeScopes.includes(changeScope)) changeScopes.unshift(changeScope);
  return {
    threadId: expectedThreadId,
    revision: source.revision,
    ...(changeScope === null ? {} : { changeScope }),
    ...(changeScopes === null ? {} : { changeScopes }),
    ...(kind === "attachments" ? {} : { changes }),
    ...(kind === "changes" ? {} : { attachments }),
  };
}

function mergeThreadResources(previous: ThreadResourcesValue | null, patch: ThreadResourcesPatch): ThreadResourcesValue {
  return {
    threadId: patch.threadId,
    revision: patch.revision,
    changeScope: patch.changeScope ?? previous?.changeScope ?? "session",
    changeScopes: patch.changeScopes ?? previous?.changeScopes ?? [patch.changeScope ?? "session"],
    changes: patch.changes ?? previous?.changes ?? [],
    attachments: patch.attachments ?? previous?.attachments ?? [],
  };
}

function threadResourceKinds(kind: ThreadResourceLoadKind): readonly ThreadResourceKind[] {
  return kind === "all" ? ["changes", "attachments"] : [kind];
}

function mergeThreadResourceKinds(
  current: readonly ThreadResourceKind[],
  requested: readonly ThreadResourceKind[],
): ThreadResourceKind[] {
  return [...new Set([...current, ...requested])];
}

function initializedThreadResourceKinds(
  row: { value: ThreadResourcesValue | null; readyKinds?: readonly ThreadResourceKind[] } | undefined,
): readonly ThreadResourceKind[] {
  if (row?.readyKinds !== undefined) return row.readyKinds;
  return row?.value == null ? [] : ["changes", "attachments"];
}

function subtractThreadResourceKinds(
  current: readonly ThreadResourceKind[],
  completed: readonly ThreadResourceKind[],
): ThreadResourceKind[] {
  return current.filter((kind) => !completed.includes(kind));
}

function clearThreadResourceErrors(
  current: Partial<Record<ThreadResourceKind, string>> | undefined,
  requested: readonly ThreadResourceKind[],
): Partial<Record<ThreadResourceKind, string>> {
  const next = { ...current };
  for (const kind of requested) delete next[kind];
  return next;
}

function setThreadResourceErrors(
  current: Partial<Record<ThreadResourceKind, string>> | undefined,
  requested: readonly ThreadResourceKind[],
  message: string,
): Partial<Record<ThreadResourceKind, string>> {
  const next = { ...current };
  for (const kind of requested) next[kind] = message;
  return next;
}

function parseThreadChangeDiff(value: unknown, expectedThreadId: string, requestedPath: string, requestedScope?: ThreadChangeScope): ThreadChangeDiffValue {
  const source = asRecord(value);
  if (
    source === null
    || source.threadId !== expectedThreadId
    || typeof source.path !== "string"
    || typeof source.truncated !== "boolean"
    || !Array.isArray(source.patches)
  ) throw new Error("Companion returned an invalid thread change diff");
  const patches = source.patches.slice(0, 10_000).flatMap((entry) => {
    const patch = asRecord(entry);
    if (
      patch === null
      || typeof patch.turnId !== "string"
      || typeof patch.itemId !== "string"
      || (patch.kind !== "add" && patch.kind !== "delete" && patch.kind !== "update")
      || typeof patch.diff !== "string"
    ) return [];
    return [{ turnId: patch.turnId, itemId: patch.itemId, kind: patch.kind as "add" | "delete" | "update", diff: patch.diff }];
  });
  const normalizedRequested = requestedPath.replaceAll("\\", "/").replace(/^\/+/, "");
  const normalizedReturned = source.path.replaceAll("\\", "/");
  if (normalizedReturned !== requestedPath.replaceAll("\\", "/") && !normalizedReturned.endsWith(`/${normalizedRequested}`)) {
    throw new Error("Companion returned a diff for a different path");
  }
  const changeScope = parseThreadChangeScope(source.changeScope) ?? requestedScope ?? "session";
  if (requestedScope !== undefined && changeScope !== requestedScope) {
    throw new Error("Companion returned a diff for a different change scope");
  }
  const scopedSource = typeof source.source === "string" ? source.source : null;
  return { threadId: expectedThreadId, path: source.path, changeScope, patches, source: scopedSource, truncated: source.truncated };
}

function parseThreadChangeScope(value: unknown): ThreadChangeScope | null {
  return value === "session" || value === "lastTurn" || value === "staged" || value === "unstaged" || value === "branch" ? value : null;
}

function parseChangeAvailability(value: unknown, kind: unknown): ThreadResourcesValue["changes"][number]["availability"] {
  if (value === "available" || value === "deleted" || value === "unavailable") return value;
  return kind === "delete" ? "deleted" : "unknown";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Remote operation failed";
}
