import type {
  AccountRateLimitsUpdatedNotification,
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
import { createTextOutboxCommand, MAX_TURN_TEXT_CHARS, RpcResponseError, seedThreadExecutionSettings, threadIdFromEvent, threadProjectionPatchFromEvent, type RemoteFileAttachment, type RpcClient, type SyncEvent } from "@codewide/sync-client";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createOptimisticAction, useLiveQuery } from "@tanstack/react-db";
import { useSyncExternalStore } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";

import { validateConnectionInput, validateConnectionRuntimeUpdate, type ConnectionInput, type ConnectionUpdateInput } from "./connection-validation";
import { commitNativeThenProject } from "./durable-command-boundary";
import { accountRateLimitsStale } from "./account-rate-limits";
import type { AccountLoginStart, AccountPoolSnapshot } from "./account-pool";
import { createAccountRateLimitsDatabase, type AccountRateLimitsDatabase } from "./account-rate-limits-database";
import { createConnectionProfileDatabase, type ConnectionProfileDatabase } from "./connection-profile-database";
import type { StoredConnection } from "./connection-profile-types";
import { createConnectionStateDatabase, type ConnectionStateDatabase } from "./connection-state-database";
import { createThreadDetailDatabase, type ThreadDetailDatabase } from "./thread-detail-database";
import type { PendingTimelineMutation } from "./thread-detail-projection";
import { projectThreadHotStates } from "./thread-hot-state";
import { createThreadUiStateDatabase, type ThreadUiStateDatabase } from "./thread-ui-state-database";
import { incrementMetric, recordTiming } from "./operational-metrics";
import { hasAcceptedPendingDelivery, parseHostQueueSnapshot } from "./queue-event";
import { queuedInputPayload } from "./queued-input";
import { createPendingRequestDatabase, type PendingRequestDatabase } from "./pending-request-database";
import type { PendingServerRequest } from "./pending-request-types";
import { RealtimeAudioUploader } from "./realtime-audio-uploader";
import { LegacyRemoteStore } from "./legacy-remote-store";
import { createThreadSummaryDatabase, type ThreadSummaryDatabase } from "./thread-summary-database";
import { createThreadProjectionStore } from "./thread-projection-store";
import { streamRepairThreadIds, terminalProjectionMatches, terminalProjectionProofs } from "./stream-recovery";
import { materializeLegacyThreadWindow, materializeResumedThread, type CompanionThreadResumeResponse } from "./thread-read-model";
import { shouldRefreshInvalidatedThread } from "./thread-detail-invalidation";
import { SubagentListProjection } from "./subagent-projection";
import { loadSubagentDescendants, subagentActivityRootThreadId } from "./subagent-loader";
import { ThreadListProjection } from "./thread-list-projection";
import type { StoredThreadSummary } from "./thread-summary-types";
import type { StoredComposerPreferences } from "./thread-ui-state-types";
import { buildThreadForkParams, type ThreadForkOptions } from "./thread-fork";
import { THREAD_HISTORY_PAGE_SIZE, THREAD_TURN_PAGE_SIZE } from "./thread-pagination";
import { cloneTurnControls, loadTurnControlsIncrementally } from "./turn-controls-loader";
import { createWorkspaceResourceDatabase, threadResourceKey, tunnelResourceKey, turnControlsResourceKey, type BackgroundTerminalValue, type ThreadResourcesValue, type TunnelValue, type TurnControlsValue, type WorkspaceResourceDatabase } from "./workspace-resource-database";
import { RetryableVoiceTranscriptionError, UnretryableVoiceTranscriptionError, VoiceInputController, type VoiceTranscriptionEvent, type VoiceTranscriptionOptions, type VoiceTranscriptionSession } from "./voice-input-controller";
import { FileTransferController } from "./file-transfer-controller";
import type { TransferAccess } from "./private-transfer";
import { assertSecureCryptoRuntime } from "../polyfills/secure-crypto";
import { NativeEngineSupervisor } from "../native/native-engine";
import { acknowledgeNativeCommandReceipt, claimNativePairing, deleteNativeConnection, enqueueNativeCommand, listNativeCommands, listNativeConnectionConfigs, mintNativeSession, purgeLegacyDerivedStorage, reconnectNativeConnection, retryNativeCommand, saveNativeConnectionCredentials, setNativeConnectionEnabled, wakeNativeConnection, type NativeCommandDelivery } from "../native/native-transport";

export type RemoteWorkspace = {
  native: boolean;
  ready: boolean;
  error: string | null;
  connections: StoredConnection[];
  threads: StoredThreadSummary[];
  subagents: StoredThreadSummary[];
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
  setThreadPinned(connectionId: string, threadId: string, pinned: boolean): Promise<void>;
  startThread(connectionId: string, cwd?: string): Promise<string>;
  renameThread(connectionId: string, threadId: string, name: string): Promise<void>;
  archiveThread(connectionId: string, threadId: string): Promise<void>;
  unarchiveThread(connectionId: string, threadId: string): Promise<void>;
  deleteThread(connectionId: string, threadId: string): Promise<void>;
  markThreadRead(connectionId: string, threadId: string): Promise<void>;
  loadDraft(connectionId: string, threadId: string): Promise<string>;
  saveDraft(connectionId: string, threadId: string, text: string): Promise<void>;
  loadDraftAttachments(connectionId: string, threadId: string): Promise<RemoteFileAttachment[]>;
  saveDraftAttachments(connectionId: string, threadId: string, attachments: RemoteFileAttachment[]): Promise<void>;
  loadScrollOffset(connectionId: string, threadId: string): Promise<number | null>;
  saveScrollOffset(connectionId: string, threadId: string, offset: number): Promise<void>;
  loadComposerPreferences(connectionId: string, threadId: string): Promise<StoredComposerPreferences | null>;
  saveComposerPreferences(connectionId: string, threadId: string, preferences: StoredComposerPreferences): Promise<void>;
  listQueuedPrompts(connectionId: string, threadId: string): Promise<QueuedPrompt[]>;
  editQueuedPrompt(connectionId: string, commandId: string, text: string, attachments: RemoteFileAttachment[]): Promise<void>;
  cancelQueuedPrompt(connectionId: string, commandId: string): Promise<void>;
  moveQueuedPrompt(connectionId: string, threadId: string, commandId: string, direction: -1 | 1): Promise<void>;
  steerQueuedPrompt(connectionId: string, commandId: string, expectedTurnId: string): Promise<void>;
  listBackgroundTerminals(connectionId: string, threadId: string): Promise<BackgroundTerminal[]>;
  terminateBackgroundTerminal(connectionId: string, threadId: string, processId: string): Promise<boolean>;
  readThread(connectionId: string, threadId: string, cachedThread?: Thread | null): Promise<ThreadWindow | null>;
  readSubagentThread(connectionId: string, threadId: string): Promise<ThreadWindow | null>;
  refreshSubagents(connectionId: string, rootThreadId: string): Promise<void>;
  loadThreadResources(connectionId: string, threadId: string): Promise<ThreadResourcesValue>;
  loadThreadChangeDiff(connectionId: string, threadId: string, path: string): Promise<ThreadChangeDiffValue>;
  reconcileThreadLifecycle(connectionId: string, threadId: string, turnId: string, cachedThread: Thread): Promise<void>;
  loadOlderTurns(connectionId: string, threadId: string, cursor: string): Promise<ThreadTurnPage>;
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
};
export type ComposerAttachment = RemoteFileAttachment;
export type TurnControls = TurnControlsValue;
export type TunnelPreview = TunnelValue;
export type { TransferAccess } from "./private-transfer";
export type ThreadWindow = { thread: Thread; nextCursor: string | null };
export type ThreadTurnPage = { turns: Turn[]; nextCursor: string | null };
export type ThreadChangeDiffValue = {
  threadId: string;
  path: string;
  patches: Array<{ turnId: string; itemId: string; kind: "add" | "delete" | "update"; diff: string }>;
  truncated: boolean;
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
  readThreadAuthoritatively(connectionId: string, threadId: string): Promise<ThreadWindow | null>;
};
const CONNECTION_PROFILE_MIGRATION_KEY = "codex-remote-connection-profiles-v1-migrated";
const CONNECTION_PROFILE_STORAGE_MIGRATION_KEY = "codex-remote-connection-profiles-cache-split-v1-migrated";
const NATIVE_CREDENTIAL_MIGRATION_KEY = "codex-remote-native-credentials-v1-migrated";
const TURN_CONTROLS_FRESH_MS = 6 * 60 * 60 * 1_000;
const EMPTY_TURN_CONTROLS: TurnControls = { models: [], skills: [], permissions: [] };

type WorkspaceRuntimeSnapshot = {
  ready: boolean;
  error: string | null;
  connectionProfiles: ConnectionProfileDatabase | null;
  connectionStates: ConnectionStateDatabase | null;
  threadSummaries: ThreadSummaryDatabase | null;
  threadDetails: ThreadDetailDatabase | null;
  pendingRequests: PendingRequestDatabase | null;
  threadUiState: ThreadUiStateDatabase | null;
  resources: WorkspaceResourceDatabase | null;
  accountRateLimits: AccountRateLimitsDatabase | null;
};

const EMPTY_THREAD_SUMMARIES: readonly StoredThreadSummary[] = [];
const EMPTY_PENDING_REQUESTS: readonly PendingServerRequest[] = [];

class WorkspaceRuntime {
  readonly native = Platform.OS === "android";
  snapshot: WorkspaceRuntimeSnapshot = {
    ready: !this.native,
    error: null,
    connectionProfiles: null,
    connectionStates: null,
    threadSummaries: null,
    threadDetails: null,
    pendingRequests: null,
    threadUiState: null,
    resources: null,
    accountRateLimits: null,
  };
  readonly listeners = new Set<() => void>();
  readonly threadUiStateSeedInFlight = new Map<string, ReturnType<typeof seedThreadUiState>>();
  readonly httpSessions = new Map<string, { credentialKey: string; sessionToken: string; expiresAt: number }>();
  readonly httpSessionMintInFlight = new Map<string, { credentialKey: string; promise: Promise<{ sessionToken: string; expiresAt: number }> }>();
  readonly threadReadInFlight = new Map<string, Promise<ThreadWindow | null>>();
  readonly threadInvalidationGeneration = new Map<string, number>();
  readonly threadInvalidationRefreshInFlight = new Map<string, Promise<void>>();
  readonly threadInvalidationArchived = new Map<string, boolean>();
  readonly threadInvalidationActive = new Map<string, boolean>();
  readonly threadResourcesInFlight = new Map<string, Promise<ThreadResourcesValue>>();
  readonly subagentRefreshInFlight = new Map<string, Promise<void>>();
  readonly turnItemsInFlight = new Map<string, Promise<Turn["items"]>>();
  readonly lifecycleRepairAttempt = new Map<string, number>();
  readonly threadListProjection = new ThreadListProjection();
  readonly subagentListProjection = new SubagentListProjection();
  readonly turnControlsInFlight = new Map<string, Promise<TurnControls>>();
  readonly accountRateLimitsInFlight = new Map<string, Promise<GetAccountRateLimitsResponse>>();
  readonly connectionAttemptStartedAt = new Map<string, number>();
  supervisor: NativeEngineSupervisor | null = null;
  voiceController: VoiceInputController | null = null;
  fileTransferController: FileTransferController | null = null;
  startPromise: Promise<void> | null = null;
  profileSubscription: { unsubscribe(): void } | null = null;
  connectionStateSubscription: { unsubscribe(): void } | null = null;

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
      const claimed = await claimNativePairing({
        endpoint: validated.endpoint,
        pairingToken: validated.token,
        deviceName: "CodeWide Android",
        ...(validated.tlsPinSha256 === undefined ? {} : { tlsPinSha256: validated.tlsPinSha256 }),
      });
      const connectionId = `connection-${randomUUID()}`;
      const nativeCredentials = {
        connectionId,
        endpoint: validated.endpoint,
        token: claimed.capabilityToken,
        enabled: true,
        ...(validated.tlsPinSha256 === undefined ? {} : { tlsPinSha256: validated.tlsPinSha256 }),
      };
      try {
        await saveNativeConnectionCredentials(nativeCredentials);
        const connection = await profiles.add({ ...validated, token: claimed.capabilityToken }, connectionId);
        wakeNativeConnection(connection.id);
        await refreshConnectionProfiles();
        workspaceRuntime.snapshot.connectionStates?.setState(connection.id, "connecting", null);
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
            workspaceRuntime.snapshot.connectionStates?.setState(recovered.id, "connecting", null);
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
      await deleteNativeConnection(connectionId);
      await requireConnectionProfileDatabase(workspaceRuntime.snapshot.connectionProfiles).delete(connectionId);
      workspaceRuntime.httpSessions.delete(connectionId);
      await refreshConnectionProfiles();
      workspaceRuntime.snapshot.connectionStates?.remove(connectionId);
      workspaceRuntime.snapshot.accountRateLimits?.remove(connectionId);
      await workspaceRuntime.snapshot.threadUiState?.deleteConnection(connectionId);
    };
  
    const setConnectionEnabled = async (connectionId: string, enabled: boolean) => {
      const profiles = requireConnectionProfileDatabase(workspaceRuntime.snapshot.connectionProfiles);
      await setNativeConnectionEnabled(connectionId, enabled);
      await profiles.setEnabled(connectionId, enabled);
      if (!enabled) workspaceRuntime.supervisor?.session(connectionId)?.stop();
      await refreshConnectionProfiles();
      workspaceRuntime.snapshot.connectionStates?.setState(connectionId, enabled ? "connecting" : "offline", null);
    };
  
    const reconnectConnection = async (connectionId: string): Promise<void> => {
      const connection = currentConnections().find((candidate) => candidate.id === connectionId);
      if (connection === undefined || !connection.enabled) throw new Error("Connection is disabled or missing");
      workspaceRuntime.snapshot.connectionStates?.setState(connectionId, "connecting", null);
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
      workspaceRuntime.snapshot.connectionStates?.setState(connectionId, "connecting", null);
    };
  
    const moveConnection = async (connectionId: string, direction: -1 | 1) => {
      await requireConnectionProfileDatabase(workspaceRuntime.snapshot.connectionProfiles).move(connectionId, direction);
      await refreshConnectionProfiles();
    };
  
    const searchThreads = async (query: string, connectionId: string | null = null) => {
      return projectThreadHotStates(
        workspaceRuntime.snapshot.threadSummaries?.search(query, connectionId) ?? [],
        workspaceRuntime.snapshot.pendingRequests?.collection.toArray ?? [],
      );
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
      await workspaceRuntime.snapshot.threadDetails?.replaceThread(connectionId, started);
      await workspaceRuntime.snapshot.threadSummaries?.insertStartedThread(connectionId, started);
      // Catalogs are scoped by server + cwd, not by turn. Warm them as soon as
      // the shell exists instead of waiting for thread/resume after a message.
      void loadTurnControls(connectionId, started.cwd).catch(() => undefined);
      return started.id;
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
  
    const loadDraftAttachments = async (connectionId: string, threadId: string): Promise<RemoteFileAttachment[]> => {
      return (await getOrCreateThreadUiState(connectionId, threadId, workspaceRuntime.snapshot.threadUiState, workspaceRuntime.threadUiStateSeedInFlight)).attachments;
    };
  
    const saveDraftAttachments = async (connectionId: string, threadId: string, attachments: RemoteFileAttachment[]): Promise<void> => {
      await requireThreadUiStateDatabase(workspaceRuntime.snapshot.threadUiState).saveAttachments(connectionId, threadId, attachments);
    };
  
    const loadScrollOffset = async (connectionId: string, threadId: string): Promise<number | null> => {
      return (await getOrCreateThreadUiState(connectionId, threadId, workspaceRuntime.snapshot.threadUiState, workspaceRuntime.threadUiStateSeedInFlight)).scrollOffset;
    };
  
    const saveScrollOffset = async (connectionId: string, threadId: string, offset: number): Promise<void> => {
      await requireThreadUiStateDatabase(workspaceRuntime.snapshot.threadUiState).saveScrollOffset(connectionId, threadId, offset);
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
          // Persisted TanStack projection remains available offline.
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

    const loadThreadResources = async (connectionId: string, threadId: string): Promise<ThreadResourcesValue> => {
      const key = threadResourceKey(connectionId, threadId);
      const pending = workspaceRuntime.threadResourcesInFlight.get(key);
      if (pending !== undefined) return await pending;
      const operation = (async () => {
        const previous = workspaceRuntime.resourceDatabase.threadResources.get(key)?.value ?? null;
        workspaceRuntime.resourceDatabase.putThreadResources({
          id: key,
          connectionId,
          threadId,
          status: "loading",
          value: previous,
          error: null,
        });
        try {
          const session = workspaceRuntime.supervisor?.session(connectionId);
          if (session === undefined) throw new Error("Connection is not enabled");
          const expectedRecencyAt = workspaceRuntime.snapshot.threadSummaries?.collection.toArray.find((summary) => (
            summary.connectionId === connectionId && summary.remoteThreadId === threadId
          ))?.recencyAt ?? null;
          const response = await rpcAfterAttach<unknown>(session, "companion/threadResources/read", {
            threadId,
            ...(expectedRecencyAt === null ? {} : { expectedRecencyAt }),
          });
          const value = parseThreadResources(response, threadId);
          workspaceRuntime.resourceDatabase.putThreadResources({ id: key, connectionId, threadId, status: "ready", value, error: null });
          return value;
        } catch (cause) {
          workspaceRuntime.resourceDatabase.putThreadResources({
            id: key,
            connectionId,
            threadId,
            status: "error",
            value: previous,
            error: errorMessage(cause),
          });
          throw cause;
        }
      })();
      workspaceRuntime.threadResourcesInFlight.set(key, operation);
      try {
        return await operation;
      } finally {
        if (workspaceRuntime.threadResourcesInFlight.get(key) === operation) workspaceRuntime.threadResourcesInFlight.delete(key);
      }
    };

    const loadThreadChangeDiff = async (connectionId: string, threadId: string, path: string): Promise<ThreadChangeDiffValue> => {
      const session = workspaceRuntime.supervisor?.session(connectionId);
      if (session === undefined) throw new Error("Connection is not enabled");
      const response = await rpcAfterAttach<unknown>(session, "companion/threadChange/read", { threadId, path });
      return parseThreadChangeDiff(response, threadId, path);
    };

    const refreshSubagents = (connectionId: string, rootThreadId: string): Promise<void> => {
      const key = `${connectionId}\u0000${rootThreadId}`;
      const pending = workspaceRuntime.subagentRefreshInFlight.get(key);
      if (pending !== undefined) return pending;
      const operation = (async () => {
        const session = workspaceRuntime.supervisor?.session(connectionId);
        const summaries = workspaceRuntime.snapshot.threadSummaries;
        if (session === undefined || summaries === null) return;
        const descendants = await loadSubagentDescendants(session, rootThreadId);
        await summaries.mergeSnapshots(connectionId, descendants);
      })().finally(() => {
        if (workspaceRuntime.subagentRefreshInFlight.get(key) === operation) {
          workspaceRuntime.subagentRefreshInFlight.delete(key);
        }
      });
      workspaceRuntime.subagentRefreshInFlight.set(key, operation);
      return operation;
    };
  
    const readThread = async (
      connectionId: string,
      threadId: string,
      cachedThread?: Thread | null,
      requireAuthoritative = false,
    ): Promise<ThreadWindow | null> => {
      const regularRequestKey = `${connectionId}\u0000${threadId}`;
      const authoritativeRequestKey = `${regularRequestKey}\u0000authoritative`;
      if (!requireAuthoritative) {
        const authoritative = workspaceRuntime.threadReadInFlight.get(authoritativeRequestKey);
        if (authoritative !== undefined) return await authoritative;
      } else {
        const regular = workspaceRuntime.threadReadInFlight.get(regularRequestKey);
        if (regular !== undefined) {
          try {
            await regular;
          } catch {
            // The strict read below is the recovery boundary.
          }
        }
      }
      const requestKey = requireAuthoritative ? authoritativeRequestKey : regularRequestKey;
      const inFlight = workspaceRuntime.threadReadInFlight.get(requestKey);
      if (inFlight !== undefined) return await inFlight;
      const operation = (async (): Promise<ThreadWindow | null> => {
        const details = workspaceRuntime.snapshot.threadDetails;
        const summaries = workspaceRuntime.snapshot.threadSummaries;
        const cached = cachedThread ?? details?.getThread(connectionId, threadId) ?? null;
        // Capture before sending the authoritative request. Only invalidations at
        // or below this cursor can be cleared by its response; newer events stay
        // dirty and force another refresh instead of being lost in a race.
        const refreshCursor = details?.captureRefreshCursor(connectionId, threadId) ?? null;
        const session = workspaceRuntime.supervisor?.session(connectionId);
        if (session === undefined) {
          await reconcileActiveThreadCommands(details, connectionId, threadId);
          if (requireAuthoritative) throw new Error("Authoritative thread repair requires an active connection");
          return cached === null ? null : { thread: recentThreadWindow(cached), nextCursor: null };
        }
        // The global state-DB snapshot may omit older spawned descendants.
        // Refresh them independently so opening the chat is never blocked by
        // rollout scanning and the chip updates as soon as the index arrives.
        void refreshSubagents(connectionId, threadId).catch((cause: unknown) => {
          console.warn("CodeWide subagent refresh failed:", cause instanceof Error ? cause.message : "unknown error");
        });
        const persistHydratedThread = async (hydrated: Thread): Promise<void> => {
          await details?.replaceThread(connectionId, hydrated, refreshCursor);
          await reconcileActiveThreadCommands(details, connectionId, threadId);
          const previous = summaries?.collection.toArray.find((candidate) => (
            candidate.connectionId === connectionId && candidate.remoteThreadId === threadId
          ));
          await summaries?.mergeSnapshots(connectionId, [{
            thread: hydrated,
            archived: previous?.archived ?? workspaceRuntime.threadInvalidationArchived.get(regularRequestKey) ?? false,
          }]);
        };
        try {
          const resumeStartedAt = performance.now();
          const response = await rpcAfterAttach<CompanionThreadResumeResponse>(session, "thread/resume", {
            threadId,
            excludeTurns: true,
            initialTurnsPage: {
              limit: THREAD_TURN_PAGE_SIZE,
              sortDirection: "desc",
              itemsView: "summary",
            },
          });
          recordTiming("thread_resume_ms", performance.now() - resumeStartedAt);
          let page = response.initialTurnsPage;
          if (page === null && response.turnsBackwardsCursor !== null) {
            page = await rpcAfterAttach<ThreadTurnsListResponse>(session, "thread/turns/list", {
              threadId,
              cursor: response.turnsBackwardsCursor,
              limit: THREAD_TURN_PAGE_SIZE,
              sortDirection: "desc",
              itemsView: "summary",
            });
          }
          const hydrated = materializeResumedThread(
            page === response.initialTurnsPage ? response : { ...response, initialTurnsPage: page },
            cached,
          );
          await persistHydratedThread(hydrated);
          void loadTurnControls(connectionId, hydrated.cwd).catch(() => undefined);
          void loadThreadResources(connectionId, threadId).catch(() => undefined);
          return { thread: hydrated, nextCursor: page?.nextCursor ?? null };
        } catch (cause) {
          console.warn("CodeWide thread refresh failed:", cause instanceof Error ? cause.message : "unknown error");
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
              limit: THREAD_TURN_PAGE_SIZE,
              sortDirection: "desc",
              itemsView: "summary",
            });
            const hydrated = materializeLegacyThreadWindow(read.thread, [...page.data].reverse(), cached);
            await persistHydratedThread(hydrated);
            void loadTurnControls(connectionId, hydrated.cwd).catch(() => undefined);
            void loadThreadResources(connectionId, threadId).catch(() => undefined);
            return { thread: hydrated, nextCursor: page.nextCursor };
          } catch (fallbackCause) {
            console.warn("CodeWide read-only thread fallback failed:", fallbackCause instanceof Error ? fallbackCause.message : "unknown error");
            if (!requireAuthoritative && cached !== null && cached.turns.length > 0) {
              return { thread: recentThreadWindow(cached), nextCursor: null };
            }
            throw fallbackCause;
          }
        }
      })();
      workspaceRuntime.threadReadInFlight.set(requestKey, operation);
      try {
        return await operation;
      } finally {
        if (workspaceRuntime.threadReadInFlight.get(requestKey) === operation) workspaceRuntime.threadReadInFlight.delete(requestKey);
      }
    };

    const readThreadAuthoritatively = async (
      connectionId: string,
      threadId: string,
    ): Promise<ThreadWindow | null> => await readThread(connectionId, threadId, undefined, true);
  
    const loadOlderTurns = async (connectionId: string, threadId: string, cursor: string): Promise<ThreadTurnPage> => {
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
      await workspaceRuntime.snapshot.threadDetails?.prependTurns(connectionId, threadId, turns);
      return { turns, nextCursor: page.nextCursor };
    };

    const readSubagentThread = async (connectionId: string, threadId: string): Promise<ThreadWindow | null> => {
      // A subagent is still a regular Codex thread. Reusing the authoritative
      // resume path preserves model, effort and permission settings in the
      // local projection; the old thread/read-only path returned transcript
      // data without those settings, so read-only chips rendered unavailable.
      return await readThread(connectionId, threadId);
    };
  
    const reconcileThreadLifecycle = async (
      connectionId: string,
      threadId: string,
      turnId: string,
      cachedThread: Thread,
    ): Promise<void> => {
      const repairKey = `${connectionId}\u0000${threadId}\u0000${turnId}`;
      const now = Date.now();
      if (now - (workspaceRuntime.lifecycleRepairAttempt.get(repairKey) ?? 0) < 5_000) return;
      workspaceRuntime.lifecycleRepairAttempt.set(repairKey, now);
      await readThread(connectionId, threadId, cachedThread);
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
        text,
        attachments: options.attachments ?? [],
        state: "queued",
        attempts: 0,
        lastError: null,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      });
      const submit = createOptimisticAction<{ row: typeof pending }>({
        onMutate: ({ row }) => { details.collection.insert(row); },
        mutationFn: async ({ row }) => {
          await commitNativeThenProject(
            async () => {
              if (presentation === "queue") {
                await enqueueNativeCommand(connectionId, `queue-put-${randomUUID()}`, "companion/queue/put", {
                  command: { ...command, presentation },
                });
              } else {
                await enqueueNativeCommand(connectionId, command.commandId, command.method, command.params);
              }
            },
            async () => {
              const projected = await details.commitPending({
                ...row,
                pending: row.pending === null || row.pending === undefined
                  ? null
                  : { ...row.pending, state: presentation === "queue" ? "queued" : "accepted", updatedAt: Date.now() },
              });
              if (!projected) console.warn("Accepted command will be reconciled from the native outbox when the thread becomes active");
            },
          );
        },
      });
      const transaction = submit({ row: pending });
      await transaction.isPersisted.promise;
      return command.commandId;
    };

    const retryFailedMessage = async (connectionId: string, commandId: string): Promise<void> => {
      const details = workspaceRuntime.snapshot.threadDetails;
      const original = (await listNativeCommands()).find((delivery) =>
        delivery.connectionId === connectionId && delivery.commandId === commandId,
      );
      if (original?.method === "turn/start" && original.state === "failed") {
        const retrying = { ...original, state: "accepted" as const, lastError: null, updatedAt: Date.now() };
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
      const cacheFresh = cached?.status === "ready"
        && cachedValue !== null
        && Date.now() - cached.updatedAt < TURN_CONTROLS_FRESH_MS;
      if (cacheFresh) return cachedValue;
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
            throw result.errors[0] ?? new Error("Could not load model, skill, or permission controls");
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
      await workspaceRuntime.snapshot.threadDetails?.replaceThread(connectionId, response.thread);
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
        const [response, accountPool] = await Promise.all([
          rpcAfterAttach<GetAccountRateLimitsResponse>(session, "account/rateLimits/read", {}),
          rpcAfterAttach<AccountPoolSnapshot>(session, "companion/accountPool/list", {}).catch(() => null),
        ]);
        database.putSnapshot(connectionId, response);
        if (accountPool !== null) database.putAccountPool(connectionId, accountPool);
        return response;
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
  
    const scopedHttpAuthorization = async (connection: StoredConnection, forceRefresh = false): Promise<string> => {
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
    };
  
    const createLocalhostTunnel = async (connectionId: string, port: number, ttlSeconds: number): Promise<TunnelPreview> => {
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("Port must be between 1 and 65535");
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3_600) throw new Error("TTL must be 30–3600 seconds");
      const key = tunnelResourceKey(connectionId);
      workspaceRuntime.resourceDatabase.putTunnel({ id: key, connectionId, status: "creating", tunnel: null, error: null });
      try {
        const connection = currentConnections().find((candidate) => candidate.id === connectionId);
        if (connection === undefined) throw new Error("Connection not found");
        const controlUrl = companionHttpUrl(connection.endpoint, "/v1/tunnels");
        const authorization = await scopedHttpAuthorization(connection);
        const response = await fetch(controlUrl, {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({ port, ttlSeconds }),
        });
        if (!response.ok) throw new Error(`Tunnel creation failed (${response.status})`);
        const body = await response.json() as { id: string; expiresAt: number; basePath: string };
        const tunnel = { id: body.id, expiresAt: body.expiresAt, url: companionHttpUrl(connection.endpoint, body.basePath), authorization };
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
        const response = await fetch(companionHttpUrl(connection.endpoint, `/v1/tunnels/${encodeURIComponent(tunnelId)}`), {
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
      return { baseUrl: companionHttpUrl(connection.endpoint, "/"), authorization: await scopedHttpAuthorization(connection, forceRefresh) };
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
    readThreadAuthoritatively,
    readSubagentThread,
    refreshSubagents,
    loadThreadResources,
    loadThreadChangeDiff,
    loadOlderTurns,
    reconcileThreadLifecycle,
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
      const known = workspaceRuntime.snapshot.threadSummaries?.collection.toArray.some((candidate) => (
        candidate.connectionId === connectionId && candidate.remoteThreadId === threadId
      )) ?? false;
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
    connectionStates: connectionStateDatabase,
    threadSummaries: threadDatabase,
    threadDetails,
    pendingRequests: pendingRequestDatabase,
  } = runtime;
  const connectionStateQuery = useLiveQuery(
    () => connectionStateDatabase?.collection,
    [connectionStateDatabase],
  );
  const connectionProfileQuery = useLiveQuery(
    () => connectionProfileDatabase?.collection,
    [connectionProfileDatabase],
  );
  const connectionProfiles = connectionProfileDatabase?.project(connectionProfileQuery.data === undefined ? undefined : [...connectionProfileQuery.data]) ?? [];
  const connections = (() => {
    const states = new Map((connectionStateQuery.data ?? []).map((row) => [row.connectionId, row]));
    return connectionProfiles.map((profile) => {
      const state = states.get(profile.id);
      return state === undefined ? profile : {
        ...profile,
        state: state.state,
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
  const threadQuery = useLiveQuery(
    () => threadDatabase?.collection,
    [threadDatabase],
  );
  const threadSummaries = threadQuery.data ?? EMPTY_THREAD_SUMMARIES;
  const threads = workspaceRuntime.threadListProjection.project(
    threadSummaries,
    pendingRequestQuery.data ?? EMPTY_PENDING_REQUESTS,
  );
  const subagents = workspaceRuntime.subagentListProjection.project(threadSummaries);

  

  return {
    native,
    ready,
    error,
    connections,
    threads,
    subagents,
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
  try {
    assertSecureCryptoRuntime();
    startupStage = "local database";
    const profiles = createConnectionProfileDatabase();
    const connectionStates = createConnectionStateDatabase();
    const summaries = createThreadSummaryDatabase();
    const details = createThreadDetailDatabase();
    const pendingRequests = createPendingRequestDatabase();
    const threadUiState = createThreadUiStateDatabase();
    const resources = createWorkspaceResourceDatabase();
    const accountRateLimits = createAccountRateLimitsDatabase();
    workspaceRuntime.voiceController = new VoiceInputController(resources);
    workspaceRuntime.fileTransferController = new FileTransferController(resources);
    // Publish the local-first stores before hydration, migrations and the
    // connection engine finish. The workspace can paint immediately while
    // TanStack collections fill from disk in the background.
    workspaceRuntime.update({
      ready: false,
      error: null,
      connectionProfiles: profiles,
      connectionStates,
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
      summaries.collection.preload(),
      details.prepare(),
      profiles.collection.preload(),
      connectionStates.collection.preload(),
      pendingRequests.collection.preload(),
      threadUiState.collection.preload(),
      resources.turnControls.preload(),
      accountRateLimits.collection.preload(),
    ]);
    // Kotlin owns the only durable command ledger. TanStack is a reconstructable
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
    const projection = createThreadProjectionStore({ summaries, details });

    startupStage = "connection engine";
    const supervisor = new NativeEngineSupervisor({
      connectionState: {
        setConnectionState(connectionId, state, diagnostic) {
          connectionStates.setState(connectionId, state, diagnostic);
        },
      },
      projection: {
        async applySnapshot(connectionId, snapshots, cursor) {
          await projection.applySnapshot(connectionId, snapshots, cursor);
          await reconcileDeliveredCommandReceipts(
            connectionId,
            snapshots.map(({ thread }) => thread),
          );
        },
        async applyEvents(connectionId, events) {
          const repairThreadIds = streamRepairThreadIds(connectionId, events, (candidateConnectionId, threadId) => (
            details.getThread(candidateConnectionId, threadId)
          ));
          const terminalProofs = terminalProjectionProofs(events);
          await projection.applyEvents(connectionId, events);
          for (const threadId of repairThreadIds) {
            const repaired = await workspaceActions.readThreadAuthoritatively(connectionId, threadId);
            if (repaired === null) throw new Error(`Authoritative stream repair returned no thread for ${threadId}`);
            for (const proof of terminalProofs.filter((candidate) => candidate.threadId === threadId)) {
              if (!terminalProjectionMatches(repaired.thread, proof)) {
                throw new Error(`Authoritative stream repair did not match terminal projection for ${threadId}`);
              }
            }
          }
          if (repairThreadIds.length > 0) incrementMetric("stream_repairs", repairThreadIds.length);
          const projectedThreadIds = new Set<string>();
          const changedThreads = new Set<string>();
          const deliveredReceiptThreads = new Set<string>();
          const subagentRoots = new Set<string>();
          for (const event of events) {
            const params = asRecord(event.payload.params);
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
                await details.replaceQueued(connectionId, queueThreadId, commands);
                if (hasAcceptedPendingDelivery(
                  commands,
                  (commandId) => details.hasPendingDelivery(connectionId, queueThreadId, commandId),
                )) {
                  deliveredReceiptThreads.add(queueThreadId);
                }
              }
            }
            if (event.payload.method === "companion/thread/invalidated" && params !== null && typeof params.threadId === "string") {
              refreshInvalidatedThread(
                connectionId,
                params.threadId,
                params.archived === true,
                params.turnActive === true,
              );
            }
            const subagentRoot = subagentActivityRootThreadId(event.payload);
            if (subagentRoot !== null) subagentRoots.add(subagentRoot);
            const threadId = threadIdFromEvent(event.payload);
            if (threadId === null) continue;
            projectedThreadIds.add(threadId);
            const patch = threadProjectionPatchFromEvent(event.payload);
            if (patch?.operation.kind === "turnStarted" || patch?.operation.kind === "turnCompleted") {
              changedThreads.add(threadId);
            } else if (patch === null && (event.payload.method === "turn/started" || event.payload.method === "turn/completed")) {
              changedThreads.add(threadId);
            }
          }
          await reconcileDeliveredCommandReceipts(
            connectionId,
            [...projectedThreadIds].flatMap((threadId) => {
              const thread = details.getThread(connectionId, threadId);
              return thread === null ? [] : [thread];
            }),
          );
          for (const threadId of changedThreads) {
            void workspaceActions.loadThreadResources(connectionId, threadId).catch(() => undefined);
          }
          for (const threadId of deliveredReceiptThreads) {
            // Companion delivery means App Server accepted turn/start. Refresh
            // the bounded authoritative window so its user item replaces the
            // local receipt even when the live item event raced or was missed.
            void workspaceActions.readThread(connectionId, threadId).catch((cause: unknown) => {
              console.warn("Could not reconcile an accepted message receipt", cause);
            });
          }
          for (const rootThreadId of subagentRoots) {
            void workspaceActions.refreshSubagents(connectionId, rootThreadId).catch((cause: unknown) => {
              console.warn("CodeWide subagent event refresh failed:", cause instanceof Error ? cause.message : "unknown error");
            });
          }
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
    });
    workspaceRuntime.supervisor = supervisor;
    connectionStates.reconcileProfiles(initialProfiles.map((connection) => ({
      id: connection.id,
      connectionId: connection.id,
      state: connection.state,
      lastError: connection.lastError,
      lastErrorAt: connection.lastErrorAt,
    })));
    supervisor.replaceConnections(initialProfiles);
    workspaceRuntime.profileSubscription?.unsubscribe();
    workspaceRuntime.profileSubscription = profiles.collection.subscribeChanges(() => {
      const currentProfiles = profiles.project();
      connectionStates.reconcileProfiles(currentProfiles.map(connectionStateSeed));
      supervisor.replaceConnections(currentProfiles);
    });
    workspaceRuntime.connectionStateSubscription?.unsubscribe();
    workspaceRuntime.connectionStateSubscription = connectionStates.collection.subscribeChanges((changes) => {
      for (const change of changes) {
        recordConnectionUsability(change.value);
        if (change.value.state === "live" && accountRateLimitsStale(accountRateLimits.get(change.value.connectionId))) {
          void workspaceActions.refreshAccountRateLimits(change.value.connectionId).catch(() => undefined);
        }
      }
    }, { includeInitialState: true });
    workspaceRuntime.update({
      ready: true,
      error: null,
      connectionProfiles: profiles,
      connectionStates,
      threadSummaries: summaries,
      threadDetails: details,
      pendingRequests,
      threadUiState,
      resources,
      accountRateLimits,
    });
    const wakeEnabledConnections = () => {
      for (const connectionId of workspaceRuntime.enabledConnectionIds()) wakeNativeConnection(connectionId);
    };
    AppState.addEventListener("focus", wakeEnabledConnections);
    AppState.addEventListener("change", (state) => {
      if (state === "active") wakeEnabledConnections();
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown startup error";
    throw new Error(`Local runtime startup failed (${startupStage}): ${message}`, { cause });
  }
}

function connectionStateSeed(connection: StoredConnection) {
  return {
    id: connection.id,
    connectionId: connection.id,
    state: connection.state,
    lastError: connection.lastError,
    lastErrorAt: connection.lastErrorAt,
  };
}

function recordConnectionUsability(connection: { connectionId: string; state: string }): void {
  if (connection.state === "connecting") {
    if (!workspaceRuntime.connectionAttemptStartedAt.has(connection.connectionId)) {
      workspaceRuntime.connectionAttemptStartedAt.set(connection.connectionId, performance.now());
    }
    return;
  }
  if (connection.state !== "syncing" && connection.state !== "live") return;
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
  inFlight: Map<string, ReturnType<typeof seedThreadUiState>>,
) {
  const uiState = requireThreadUiStateDatabase(database);
  const cached = uiState.get(connectionId, threadId);
  if (cached !== null) return cached;
  const key = `${connectionId}\u0000${threadId}`;
  const pending = inFlight.get(key);
  if (pending !== undefined) return await pending;
  const operation = seedThreadUiState(connectionId, threadId, uiState);
  inFlight.set(key, operation);
  try {
    return await operation;
  } finally {
    if (inFlight.get(key) === operation) inFlight.delete(key);
  }
}

async function seedThreadUiState(
  connectionId: string,
  threadId: string,
  uiState: ThreadUiStateDatabase,
) {
  // UI state is cache by design. Do not reopen the old app-data database on
  // thread access: doing so retained gigabytes that the server can rebuild.
  return await uiState.seedLegacy(connectionId, threadId, {
    draftText: "",
    attachments: [],
    scrollOffset: null,
    preferences: null,
  });
}

async function rpcAfterAttach<T>(session: RpcClient, method: string, params: unknown): Promise<T> {
  return await session.rpc<T>(method, params);
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

function recentThreadWindow(thread: Thread, limit = THREAD_TURN_PAGE_SIZE): Thread {
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
): Promise<void> {
  if (details === null) return;
  try {
    await details.reconcileNativeCommands(connectionId, threadId, await listNativeCommands());
  } catch (cause) {
    // The native ledger is authoritative and remains available for the next
    // active-thread refresh. A read-model repair must not make history fail.
    console.warn("Could not reconcile the active thread from the native outbox", cause);
  }
}

async function runOptimisticPendingMutation(
  details: ThreadDetailDatabase,
  mutation: PendingTimelineMutation,
  persistNative: () => Promise<void>,
): Promise<void> {
  const submit = createOptimisticAction<{ mutation: PendingTimelineMutation }>({
    onMutate: ({ mutation: next }) => {
      for (const key of next.deletes) {
        if (details.collection.has(key)) details.collection.delete(key);
      }
      for (const row of next.upserts) {
        if (details.collection.has(row.id)) {
          details.collection.update(row.id, (draft) => { Object.assign(draft, row); });
        } else {
          details.collection.insert(row);
        }
      }
    },
    mutationFn: async ({ mutation: next }) => {
      // The optimistic layer may roll back only before Kotlin has durably
      // accepted the command. After that point the native outbox owns recovery.
      await commitNativeThenProject(persistNative, async () => {
        const projected = await details.commitPendingMutation(next);
        if (!projected) console.warn("Accepted queue mutation will be reconciled from the native outbox");
      });
    },
  });
  await submit({ mutation }).isPersisted.promise;
}

function parseThreadResources(value: unknown, expectedThreadId: string): ThreadResourcesValue {
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
  return { threadId: expectedThreadId, revision: source.revision, changes, attachments };
}

function parseThreadChangeDiff(value: unknown, expectedThreadId: string, requestedPath: string): ThreadChangeDiffValue {
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
  return { threadId: expectedThreadId, path: source.path, patches, truncated: source.truncated };
}

function parseChangeAvailability(value: unknown, kind: unknown): ThreadResourcesValue["changes"][number]["availability"] {
  if (value === "available" || value === "deleted" || value === "unavailable") return value;
  return kind === "delete" ? "deleted" : "unknown";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Remote operation failed";
}
