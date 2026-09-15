import { expect, it } from "vitest";
import {
  manifest,
  connectionService,
  nativeProtocolEngine,
  nativeModule,
  nativeTransport,
  sessionCredentialClient,
  innerTlsTransport,
  nativeTelemetry,
  mainApplication,
  mainActivity,
  nativeFrameStore,
  projectionBatchPolicy,
  nativeEngine,
  nativeCommandStore,
  nativeCredentialsStore,
  deviceKeyStore,
  nativeCommandPolicy,
  opusAudioEncoder,
  gradle,
} from "./native-sources";

it("preserves native integration contracts — 1", () => {
  expect(manifest).toContain('android:foregroundServiceType="remoteMessaging"');
  expect(manifest).toContain('android:stopWithTask="false"');
  expect(connectionService).toContain("return START_STICKY");
  expect(connectionService).toContain("if (activeDefaultNetwork != network) return");
  expect(connectionService).toContain("activeDefaultNetwork = network");
  expect(connectionService).toContain("existing.attachRuntime()");
  expect(connectionService).toContain("fun wake(connectionId: String)");
  expect(connectionService).toContain("session.endpoint != saved.endpoint");
  expect(connectionService).toContain("session.token != saved.token");
  expect(connectionService).toContain("session.tlsPinSha256 != saved.innerTlsPinSha256");
  expect(connectionService).toContain("session.reconnectNow()");
  expect(connectionService).toContain("credentialHttpClient");
  expect(connectionService).toContain("CREDENTIAL_HTTP_TIMEOUT_MS = 12_000L");
  expect(connectionService).toContain("MAX_RECONNECT_DELAY_MS = 1_000L");
  expect(connectionService).toContain("minOf(reconnectAttempt, 1)");
  expect(connectionService).toContain("scheduleConnectWatchdog(generation)");
  expect(connectionService).toContain('resetTransport("connect_watchdog")');
  expect(connectionService).toContain(
    'emitTransportStatus("degraded", "Connection attempt timed out")',
  );
  expect(connectionService).toContain(
    'emitTransportStatus("degraded", transportDiagnostic(error, "Could not establish secure transport"))',
  );
  expect(connectionService).toContain('resetTransport("stale_connect_wake")');
  expect(connectionService).toContain("if (socket != null) return");
  expect(connectionService).not.toContain("latestTransportStatus");
  expect(nativeProtocolEngine).toContain(
    "private fun handleStatus(envelope: JSONObject, frameBytes: Int)",
  );
  expect(connectionService).toContain("protocolEngine.onTransportState(status, diagnostic)");
  expect(connectionService).toContain('reason == "user_reconnect"');
  expect(nativeModule).toContain("fun wakeSocket(connectionId: String)");
  expect(nativeModule).toContain("CodexConnectionService.ACTION_WAKE");
  expect(nativeTransport).toContain("export function wakeNativeConnection");
  expect(connectionService).not.toContain("existing.resetTransport()");
  expect(connectionService).toContain("NativeProtocolEngine(");
  expect(connectionService).toContain("NotificationCompat.VISIBILITY_PRIVATE");
  expect(connectionService).toContain(
    "NotificationCompat.Builder(this, channelId).setColor(Color.WHITE)",
  );
  expect(connectionService).toContain("notifyApproval(id, threadId, requestKey)");
  expect(connectionService).toContain('optJSONArray("pendingRequests")');
  expect(connectionService).toContain("pendingApprovals.clear()");
  expect(connectionService).toContain(".setOnlyAlertOnce(true)");
  expect(connectionService).toContain('notifyTurnFinished(id, threadId, status == "failed")');
  expect(connectionService).toContain('.scheme("codewide")');
  expect(connectionService).not.toContain('params?.optString("command")');
  expect(connectionService).toContain('contextualTelemetry(generation, "socket")');
  expect(connectionService).not.toContain(
    "SessionCredentialClient.mint(credentialHttpClient, endpoint, token",
  );
  expect(connectionService).not.toContain("SessionCredentialClient.mint(");
  expect(connectionService).not.toContain("scheduleCredentialRefresh(");
  expect(connectionService).not.toContain("replacementSocket");
  expect(connectionService).toContain('.header("Authorization", "Bearer $token")');
  expect(connectionService).toContain("httpClient.dispatcher.executorService.execute");
  expect(nativeProtocolEngine).toContain('.put("protocolVersion", 1)');
  expect(nativeProtocolEngine).toContain("SYNC_KEEPALIVE_INTERVAL_MS = 5_000L");
  expect(nativeProtocolEngine).toContain('.put("type", "ping")');
  expect(nativeProtocolEngine).toContain("startKeepalive()");
  expect(nativeProtocolEngine).toContain("stopKeepalive()");
  expect(nativeProtocolEngine).toContain('resetTransport("keepalive_send_failed")');
  expect(nativeProtocolEngine).toContain("frameStore.syncCursor(connectionId)");
  expect(nativeProtocolEngine).toContain("frameStore.appendEvents(connectionId, batch)");
  expect(nativeProtocolEngine).toContain('"journalAdvanced"');
  expect(nativeProtocolEngine).not.toContain("JSONObject(frame.payload)");
  expect(nativeProtocolEngine).toContain("ProjectionBatchPolicy.flushDelayMs(method)");
  expect(nativeProtocolEngine).toContain('.put("modelProviders", JSONArray())');
  expect(nativeProtocolEngine).toContain('.put("useStateDbOnly", true)');
  expect(connectionService).toContain('"connection.attempt_started"');
  expect(connectionService).toContain('"connection.transport_opened"');
  expect(sessionCredentialClient).toContain('"connection.auth_challenge"');
  expect(sessionCredentialClient).toContain('"connection.auth_proof"');
  expect(innerTlsTransport).toContain('"connection.outer_carrier"');
  expect(innerTlsTransport).toContain('"connection.inner_tls"');
  expect(nativeProtocolEngine).toContain('"sync.hello_received"');
  expect(nativeProtocolEngine).toContain('"sync.ingress_window"');
  expect(nativeProtocolEngine).toContain('"sync.rpc_response"');
  expect(nativeProtocolEngine).toContain('"sync.snapshot_completed"');
  expect(connectionService).toContain('"app.splash_hide_requested"');
  expect(nativeTelemetry).toContain("ReactMarkerConstants.CONTENT_APPEARED");
  expect(mainApplication).toContain("NativeStartupTrace.markApplicationStarted()");
  expect(mainApplication).toContain("NativeStartupTrace.markApplicationReady()");
  expect(mainActivity).toContain("NativeStartupTrace.registerContentMarker()");
  expect(nativeFrameStore).toContain("PROJECTION_SCHEMA_VERSION = 5");
  expect(projectionBatchPolicy).toContain("TEXT_FLUSH_DELAY_MS = 12L");
  expect(projectionBatchPolicy).toContain('"item/reasoning/textDelta"');
  expect(projectionBatchPolicy).toContain("NORMAL_FLUSH_DELAY_MS = 16L");
  expect(nativeFrameStore).toContain("native_journal_totals");
  expect(nativeFrameStore).toContain(
    "journal_frames = native_sync_state.journal_frames + excluded.journal_frames",
  );
  expect(nativeFrameStore).not.toContain("journalLimitExceeded");
  expect(nativeFrameStore).not.toContain("totalJournalLimitExceeded");
  expect(connectionService).toContain('HandlerThread("CodeWideJournal")');
  expect(nativeModule).toContain(
    "fun readCommittedFrames(connectionId: String, afterCursor: Double?, promise: Promise)",
  );
  expect(nativeModule).toContain("NATIVE_BRIDGE_CONTRACT_VERSION = 2");
  expect(nativeEngine).toContain("bridge.readCommittedFrames(this.connectionId");
  expect(nativeEngine).toContain('event.type === "journalAdvanced"');
  expect(nativeFrameStore).toContain(
    "fun acknowledgeThrough(connectionId: String, projectionCursor: Long)",
  );
  expect(nativeFrameStore).toContain("projected_cursor = ?");
  expect(nativeFrameStore).toContain("event_cursor <= ?");
  expect(nativeFrameStore).toContain("PRAGMA busy_timeout = 5000");
  expect(nativeFrameStore).toContain('"codex-remote/transport/codex-remote-frames.db"');
  expect(nativeCommandStore).toContain('"codex-remote-native-commands.db"');
  expect(nativeCredentialsStore).toContain('PREFERENCES = "codex_remote_native_sessions"');
  expect(nativeCredentialsStore).toContain(
    'KEY_ALIAS = "codex_remote_native_session_credentials_v1"',
  );
  expect(deviceKeyStore).toContain('KEY_ALIAS = "codex_remote_device_identity_v1"');
  expect(connectionService).toContain('ACTION_ATTACH = "dev.codexremote.app.ATTACH"');
  expect(nativeCommandStore).toContain("UPDATE native_commands SET state = 'uncertain'");
  expect(nativeCommandStore).toContain("MAX_BYTES_PER_CONNECTION = 16L * 1024L * 1024L");
  expect(connectionService).toContain("fun enqueueCommand(");
  expect(connectionService).toContain("fun drainOutbox()");
  expect(nativeCommandPolicy).toContain(
    '"turn/start" to NativeCommandReconciliation.IDEMPOTENT_RETRY',
  );
  expect(connectionService).toContain("reconcileTurnCommand(command, params)");
  expect(connectionService).toContain('protocolEngine.rpc(\n        "thread/turns/list"');
  expect(connectionService).toContain("turnsContainClientMessage(response, command.commandId)");
  expect(connectionService).toContain("OUTBOX_RECONCILE_DELAY_MS = 2_000L");
  expect(nativeModule).toContain("fun engineEnqueueCommand(");
  expect(nativeModule).toContain("fun engineListCommands(promise: Promise)");
  expect(nativeModule).toContain("fun engineAcknowledgeCommandReceipt(");
  expect(nativeTransport).toContain("export async function enqueueNativeCommand");
  expect(nativeTransport).toContain("export async function listNativeCommands");
  expect(nativeTransport).toContain("export async function acknowledgeNativeCommandReceipt");
  expect(nativeCommandStore).toContain(
    "fun acknowledgeDeliveryReceipt(connectionId: String, commandId: String)",
  );
  expect(nativeCommandStore).toContain("fun retryFailed(connectionId: String, commandId: String)");
  expect(nativeCommandStore).toContain('return command.copy(state = "uncertain"');
  expect(nativeEngine).toContain("onOutboxChange");
  expect(nativeFrameStore).not.toContain("SQLiteDatabase.OPEN_READONLY");
  expect(nativeFrameStore).not.toContain('"codewide.db"');
  expect(nativeFrameStore).not.toContain('"SELECT sync_cursor FROM connections WHERE id = ?"');
  expect(nativeFrameStore).toContain(
    "fun syncCursor(connectionId: String): Long? = nativeCursor(connectionId)",
  );
  expect(nativeFrameStore).toContain("MAX_TOTAL_FRAMES = 50_000L");
  expect(nativeFrameStore).toContain("MAX_TOTAL_BYTES = 256L * 1024L * 1024L");
  expect(nativeFrameStore).toContain("fun storageStats(): NativeFrameStorageStats");
  expect(nativeProtocolEngine).toContain('.put("journalPayloadBytes", storage?.payloadBytes ?: 0)');
  expect(nativeEngine).toContain(
    "journalPayloadBytes: Number.isSafeInteger(signal.journalPayloadBytes)",
  );
  expect(nativeCommandStore).toContain("fun storageStats(): NativeCommandStorageStats");
  expect(nativeCommandStore).toContain('.put("pendingBytes", storage.pendingBytes)');
  expect(nativeEngine).toContain('name: "outbox.native_sqlite_storage"');
  expect(connectionService).toContain('.header("Authorization", "Bearer $token")');
  expect(sessionCredentialClient).toContain('"$origin/v1/auth"');
  expect(sessionCredentialClient).toContain('.put("action", "challenge")');
  expect(sessionCredentialClient).toContain('.put("action", "session")');
  expect(sessionCredentialClient).toContain('getString("sessionToken")');
  expect(sessionCredentialClient).toContain(
    "DeviceKeyStore.signChallenge(savedServerId, challenge)",
  );
  expect(connectionService).toContain("if (error is SessionAuthorizationException)");
  expect(connectionService).toContain('emitTransportStatus("authRequired")');
  expect(nativeEngine).toContain('addListener("CodeWideEngineEvent"');
  expect(nativeEngine).toContain("bridge.engineRpc(this.connectionId");
  expect(nativeProtocolEngine).toContain(
    "private val deferredRpcs = linkedMapOf<String, DeferredRpc>()",
  );
  expect(nativeProtocolEngine).toContain("dispatchDeferredRpcs()");
  expect(nativeProtocolEngine).toContain("Connection recovery queue is full");
  expect(nativeProtocolEngine).toContain("RPC_LIVE_WAIT_TIMEOUT_MS = 12_000L");
  expect(nativeProtocolEngine).toContain('.put("rpcAvailable", upstreamLive)');
  expect(nativeEngine).toContain('typeof state.rpcAvailable !== "boolean"');
  expect(nativeEngine).toContain("state.rpcAvailable");
  expect(nativeEngine).toContain(
    'setConnectionState(this.connectionId, "connecting", null, false)',
  );
  expect(nativeEngine).not.toContain("waitUntilLive");
  expect(nativeModule).toContain("private const val AUDIO_CHUNKS_PER_SECOND = 5");
  expect(nativeModule).toContain("private const val OPUS_BITRATE = 24_000");
  expect(nativeModule).toContain('putString("encoding", "opus")');
  expect(opusAudioEncoder).toContain("MediaFormat.MIMETYPE_AUDIO_OPUS");
  expect(nativeEngine).toContain("this.#projection.applySnapshot");
  expect(nativeEngine).toContain("this.#projection.applyEvents");
  expect(nativeEngine).toContain("bridge?.acknowledgeProjection");
  expect(nativeTransport).not.toContain("createNativeSocket");
  expect(gradle).not.toContain("JS_OWNED_SYNC_EXPERIMENT");
  expect(connectionService).not.toContain("JS_OWNED_SYNC_EXPERIMENT");
  expect(nativeModule).not.toContain("openJsSyncSocket");
  expect(nativeModule).toContain("val publicKeySpki = DeviceKeyStore.publicKeySpki(savedServerId)");
  expect(nativeModule).toContain('.put("publicKeySpki", publicKeySpki)');
  expect(nativeModule).toContain('.put("action", "register")');
  expect(nativeModule).toContain('.put("proof", DeviceKeyStore.signPairingClaim(');
});
