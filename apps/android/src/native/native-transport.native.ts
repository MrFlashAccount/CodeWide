import type {
  NativeVoiceEvent,
  CapturedAudioChunk,
  PcmCaptureInfo,
  NativeConnectionConfig,
  NativeBrowserDevToolsBridge,
  NativeBrowserTrace,
  NativePortForwardProfile,
  NativePortForwardingPreference,
  NativePortForwardEvent,
  NativeTerminalEvent,
  NativeTerminalOutput,
  NativeTerminalSession,
  NativeDiscoveredPort,
  NativeCommandDelivery,
  MicrophonePermission,
  NativeMicrophoneLease,
  NativeCommandMethod,
} from "./native-transport-contract";

export type {
  NativeVoiceEvent,
  PcmAudioChunk,
  OpusAudioChunk,
  CapturedAudioChunk,
  PcmCaptureInfo,
  NativeConnectionConfig,
  NativeBrowserDevToolsBridge,
  NativeBrowserTrace,
  NativePortForwardProfile,
  NativePortForwardingPreference,
  NativePortForwardEvent,
  NativeTerminalEvent,
  NativeTerminalOutput,
  NativeTerminalSession,
  NativeDiscoveredPort,
  NativeCommandDelivery,
  MicrophonePermission,
  NativeMicrophoneLease,
  NativeCommandMethod,
} from "./native-transport-contract";
import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from "react-native";
import type { RemoteFileAttachment } from "@codewide/sync-client";
import { appLogger } from "../observability/logger";
import { unknownRecord } from "../data/unknownRecord";

type NativeAudioEvent = CapturedAudioChunk & {
  error?: string;
  type: "started" | "chunk" | "stopped" | "error";
};

const MAX_TERMINAL_CWD_LENGTH = 4096;
const MAX_TERMINAL_THREAD_ID_LENGTH = 512;
const TERMINAL_SESSION_ID = /^terminal-[0-9a-fA-F-]{36}$/u;

type NativeBridge = {
  addListener: (eventName: string) => void;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  claimPairing: (
    savedServerId: string,
    endpoint: string,
    pairingToken: string,
    deviceName: string,
    tlsPinSha256: string,
  ) => Promise<{ capabilityToken: string; deviceId: string }>;
  closeTerminal?: (sessionId: string) => void;
  companionHttpOrigin: (connectionId: string) => Promise<string>;
  configureFullscreenWindow?: (reactTag: number) => void;
  deleteConnectionCredentials: (connectionId: string) => Promise<void>;
  discoverPorts?: (connectionId: string) => Promise<string>;
  engineAcknowledgeCommandReceipt?: (connectionId: string, commandId: string) => Promise<void>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  engineEnqueueCommand: (
    connectionId: string,
    commandId: string,
    method: string,
    paramsJson: string,
  ) => Promise<string>;
  engineListCommands: () => Promise<string>;
  engineRetryCommand?: (connectionId: string, commandId: string) => Promise<string>;
  listConnectionConfigs: () => Promise<NativeConnectionConfig[]>;
  listPortForwards?: (connectionId: string) => Promise<string>;
  listTerminals?: () => Promise<string>;
  microphonePermissionGranted?: boolean;
  mintStoredSession: (connectionId: string) => Promise<{ expiresAt: number; sessionToken: string }>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  openTerminal?: (
    sessionId: string,
    connectionId: string,
    threadId: string,
    cwd: string | null,
    cols: number,
    rows: number,
  ) => Promise<void>;
  purgeLegacyDerivedStorage?: () => Promise<number>;
  readTerminalOutput?: (sessionId: string, offset: number, maxBytes: number) => Promise<string>;
  refreshMicrophonePermission?: () => void;
  removeListeners: (count: number) => void;
  removePortForward: (profileId: string) => Promise<void>;
  resetSocket: (connectionId: string, reason: string) => void;
  resizeTerminal?: (sessionId: string, cols: number, rows: number) => Promise<void>;
  revokeStoredConnection?: (connectionId: string) => Promise<void>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  saveConnectionCredentials: (
    connectionId: string,
    endpoint: string,
    token: string | null,
    tlsPinSha256: string | null,
    enabled: boolean,
  ) => Promise<void>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  saveConnectionCredentialsV2?: (
    connectionId: string,
    endpoint: string,
    token: string | null,
    tlsPinSha256: string | null,
    enabled: boolean,
    deviceId: string,
  ) => Promise<void>;
  setConnectionEnabled: (connectionId: string, enabled: boolean) => Promise<void>;
  setVoiceAuraOrigin?: (reactTag: number | null) => void;
  setVoiceAuraState?: (active: boolean, level: number, reducedMotion: boolean) => void;
  startBrowserDevToolsBridge?: () => Promise<NativeBrowserDevToolsBridge>;
  startBrowserTracing?: () => Promise<void>;
  startLegacyRuntimeResources?: () => Promise<void>;
  // Native-22 and older resolve void/null. Native-23 adds capture diagnostics;
  // audio chunks themselves remain the source of truth for the PCM format.
  startPcmCapture: (
    token: string,
    purpose: NativeMicrophoneLease["purpose"],
  ) => Promise<PcmCaptureInfo | null>;
  startPortForward: (profileId: string) => Promise<string>;
  startVoiceInput: (localeTag: string | null) => Promise<void>;
  stopBrowserDevToolsBridge?: () => void;
  stopBrowserTracing?: () => Promise<NativeBrowserTrace>;
  stopLegacyRuntimeResources?: () => Promise<void>;
  stopPcmCapture: (token: string, purpose: NativeMicrophoneLease["purpose"]) => Promise<void>;
  stopPortForward: (profileId: string) => Promise<string>;
  stopVoiceInput: () => void;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  upsertPortForward: (
    connectionId: string,
    profileId: string,
    label: string,
    remotePort: number,
    preferredLocalPort: number | null,
    serviceKey: string | null,
    preference: NativePortForwardingPreference,
  ) => Promise<string>;
  wakeSocket: (connectionId: string) => void;
  writeTerminal?: (sessionId: string, base64: string) => Promise<void>;
};

// WHY: React Native owns this same-binary registry and exposes no generated TypeScript contract for the registered module.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const bridge = NativeModules.CodeWideNative as NativeBridge | undefined;
const emitter = bridge === undefined ? null : new NativeEventEmitter(bridge);

let microphonePermission: MicrophonePermission =
  bridge?.microphonePermissionGranted === true ? "granted" : "denied";
const microphonePermissionListeners = new Set<() => void>();

function publishMicrophonePermission(next: MicrophonePermission): void {
  if (microphonePermission === next) {
    return;
  }
  microphonePermission = next;
  for (const notify of microphonePermissionListeners) {
    notify();
  }
}

emitter?.addListener("CodeWideMicrophonePermission", (granted: unknown) => {
  if (typeof granted !== "boolean") {
    return;
  }
  publishMicrophonePermission(
    granted ? "granted" : microphonePermission === "blocked" ? "blocked" : "denied",
  );
});

export function getMicrophonePermission(): MicrophonePermission {
  return microphonePermission;
}

export function subscribeMicrophonePermission(notify: () => void): () => void {
  microphonePermissionListeners.add(notify);
  return () => {
    microphonePermissionListeners.delete(notify);
  };
}

/** Only an explicit permission-dialog action may open Android's permission prompt. */
export async function requestMicrophonePermission(): Promise<MicrophonePermission> {
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  const permission =
    result === PermissionsAndroid.RESULTS.GRANTED
      ? "granted"
      : result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
        ? "blocked"
        : "denied";
  publishMicrophonePermission(permission);
  bridge?.refreshMicrophonePermission?.();
  return permission;
}

export async function claimNativePairing(input: {
  deviceName: string;
  endpoint: string;
  pairingToken: string;
  savedServerId: string;
  tlsPinSha256: string;
}): Promise<{ capabilityToken: string; deviceId: string }> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native secure pairing is unavailable in this build");
  }
  const claimed = await bridge.claimPairing(
    input.savedServerId,
    input.endpoint,
    input.pairingToken,
    input.deviceName,
    input.tlsPinSha256,
  );
  if (typeof claimed.deviceId !== "string" || typeof claimed.capabilityToken !== "string") {
    throw new Error("Native pairing returned an invalid security state");
  }
  return claimed;
}

export async function saveNativeConnectionCredentials(input: {
  connectionId: string;
  deviceId?: string;
  enabled: boolean;
  endpoint: string;
  tlsPinSha256?: string;
  token?: string;
}): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native credential storage is unavailable in this build");
  }
  if (input.deviceId !== undefined && bridge.saveConnectionCredentialsV2 !== undefined) {
    await bridge.saveConnectionCredentialsV2(
      input.connectionId,
      input.endpoint,
      input.token ?? null,
      input.tlsPinSha256 ?? null,
      input.enabled,
      input.deviceId,
    );
  } else {
    await bridge.saveConnectionCredentials(
      input.connectionId,
      input.endpoint,
      input.token ?? null,
      input.tlsPinSha256 ?? null,
      input.enabled,
    );
  }
}

export async function listNativeConnectionConfigs(): Promise<NativeConnectionConfig[]> {
  if (bridge === undefined || Platform.OS !== "android") {
    return [];
  }
  const raw = await bridge.listConnectionConfigs();
  if (!Array.isArray(raw)) {
    throw new Error("Native connection config projection is invalid");
  }
  return raw.map((value) => {
    const candidate = unknownRecord(value);
    if (candidate === null) {
      throw new Error("Native connection config projection is invalid");
    }
    const savedServerId = candidate.savedServerId ?? candidate.connectionId;
    const deviceId = candidate.deviceId ?? null;
    if (
      typeof candidate.connectionId !== "string" ||
      candidate.connectionId.length < 1 ||
      typeof savedServerId !== "string" ||
      savedServerId !== candidate.connectionId ||
      typeof candidate.endpoint !== "string" ||
      !(candidate.tlsPinSha256 === null || typeof candidate.tlsPinSha256 === "string") ||
      typeof candidate.enabled !== "boolean" ||
      !(
        deviceId === null ||
        (typeof deviceId === "string" && /^device-[a-f0-9]{64}$/u.test(deviceId))
      )
    ) {
      throw new Error("Native connection config projection is invalid");
    }
    return {
      connectionId: candidate.connectionId,
      deviceId,
      enabled: candidate.enabled,
      endpoint: candidate.endpoint,
      savedServerId,
      tlsPinSha256: candidate.tlsPinSha256,
    };
  });
}

export async function nativeCompanionHttpOrigin(
  connectionId: string,
  _endpoint: string,
): Promise<string> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native pinned HTTP transport is unavailable in this build");
  }
  const origin = await bridge.companionHttpOrigin(connectionId);
  if (!/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}$/u.test(origin)) {
    throw new Error("Native pinned HTTP transport returned an invalid origin");
  }
  return origin;
}

export async function purgeLegacyDerivedStorage(): Promise<number> {
  // An OTA may briefly run on an older native shell. Cleanup is retried on
  // every startup once a compatible APK is installed.
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    bridge.purgeLegacyDerivedStorage === undefined
  ) {
    return 0;
  }
  const reclaimedBytes = await bridge.purgeLegacyDerivedStorage();
  return Number.isFinite(reclaimedBytes) && reclaimedBytes >= 0 ? reclaimedBytes : 0;
}

export async function startNativeBrowserDevToolsBridge(): Promise<NativeBrowserDevToolsBridge> {
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    typeof bridge.startBrowserDevToolsBridge !== "function"
  ) {
    throw new Error("This app build does not include Chromium DevTools");
  }
  const result = unknownRecord(await bridge.startBrowserDevToolsBridge());
  if (
    result === null ||
    result.host !== "127.0.0.1" ||
    typeof result.port !== "number" ||
    !Number.isInteger(result.port) ||
    result.port < 1 ||
    result.port > 65_535 ||
    typeof result.token !== "string" ||
    !/^[a-f0-9]{64}$/u.test(result.token) ||
    typeof result.tracingSupported !== "boolean"
  ) {
    throw new Error("Native Chromium DevTools bridge returned an invalid endpoint");
  }
  return {
    host: "127.0.0.1",
    port: result.port,
    token: result.token,
    tracingSupported: result.tracingSupported,
  };
}

export function stopNativeBrowserDevToolsBridge(): void {
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    typeof bridge.stopBrowserDevToolsBridge !== "function"
  ) {
    return;
  }
  bridge.stopBrowserDevToolsBridge();
}

export async function startNativeBrowserTracing(): Promise<void> {
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    typeof bridge.startBrowserTracing !== "function"
  ) {
    throw new Error("Native WebView performance tracing is unavailable in this build");
  }
  await bridge.startBrowserTracing();
}

export async function stopNativeBrowserTracing(): Promise<NativeBrowserTrace> {
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    typeof bridge.stopBrowserTracing !== "function"
  ) {
    throw new Error("Native WebView performance tracing is unavailable in this build");
  }
  const result = unknownRecord(await bridge.stopBrowserTracing());
  if (
    result === null ||
    typeof result.path !== "string" ||
    result.path === "" ||
    typeof result.size !== "number" ||
    !Number.isFinite(result.size) ||
    result.size < 0
  ) {
    throw new Error("Native WebView performance trace result is invalid");
  }
  return { path: result.path, size: result.size };
}

export async function deleteNativeConnection(connectionId: string): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native connection storage is unavailable");
  }
  await bridge.deleteConnectionCredentials(connectionId);
}

export async function revokeRemoteConnection(connectionId: string): Promise<void> {
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    typeof bridge.revokeStoredConnection !== "function"
  ) {
    throw new Error("Update the Android app before removing this paired device");
  }
  await bridge.revokeStoredConnection(connectionId);
}

export async function setNativeConnectionEnabled(
  connectionId: string,
  enabled: boolean,
): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native connection lifecycle is unavailable in this build");
  }
  await bridge.setConnectionEnabled(connectionId, enabled);
}

export async function mintNativeSession(
  connectionId: string,
): Promise<{ expiresAt: number; sessionToken: string }> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native session proof is unavailable in this build");
  }
  return bridge.mintStoredSession(connectionId);
}

/** Permanently disables the service-owned session and removes its credentials. */
export function reconnectNativeConnection(connectionId: string): void {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native remote transport is unavailable");
  }
  bridge.resetSocket(connectionId, "user_reconnect");
}

export function wakeNativeConnection(connectionId: string): void {
  if (bridge === undefined || Platform.OS !== "android") {
    return;
  }
  bridge.wakeSocket(connectionId);
}

export async function listNativePortForwards(
  connectionId: string,
): Promise<NativePortForwardProfile[]> {
  // OTA JavaScript can run briefly on an older native shell. Port forwarding
  // is ancillary to opening a conversation, so an unavailable bridge method
  // must degrade to an empty catalog instead of producing a global LogBox.
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    typeof bridge.listPortForwards !== "function"
  ) {
    return [];
  }
  const value: unknown = JSON.parse(await bridge.listPortForwards(connectionId));
  if (!Array.isArray(value)) {
    throw new Error("Native port-forward projection is invalid");
  }
  return value.map(parseNativePortForwardProfile);
}

export async function discoverNativePorts(
  connectionId: string,
): Promise<{ ports: NativeDiscoveredPort[]; scannedAt: number }> {
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    typeof bridge.discoverPorts !== "function"
  ) {
    return { ports: [], scannedAt: Date.now() };
  }
  const value: unknown = JSON.parse(await bridge.discoverPorts(connectionId));
  const row = unknownRecord(value);
  if (row === null) {
    throw new Error("Native port discovery projection is invalid");
  }
  if (!Array.isArray(row.ports) || typeof row.scannedAt !== "number") {
    throw new Error("Native port discovery projection is invalid");
  }
  return { ports: row.ports.map(parseNativeDiscoveredPort), scannedAt: row.scannedAt };
}

export async function upsertNativePortForward(input: {
  connectionId: string;
  label: string;
  preference?: NativePortForwardingPreference;
  preferredLocalPort: number | null;
  profileId: string;
  remotePort: number;
  serviceKey?: string | null;
}): Promise<NativePortForwardProfile> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native port forwarding is available on Android only");
  }
  return parseNativePortForwardProfile(
    JSON.parse(
      await bridge.upsertPortForward(
        input.connectionId,
        input.profileId,
        input.label,
        input.remotePort,
        input.preferredLocalPort,
        input.serviceKey ?? null,
        input.preference ?? "included",
      ),
    ),
  );
}

export async function startNativePortForward(profileId: string): Promise<NativePortForwardProfile> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native port forwarding is available on Android only");
  }
  return parseNativePortForwardProfile(JSON.parse(await bridge.startPortForward(profileId)));
}

export async function stopNativePortForward(profileId: string): Promise<NativePortForwardProfile> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native port forwarding is available on Android only");
  }
  return parseNativePortForwardProfile(JSON.parse(await bridge.stopPortForward(profileId)));
}

export async function removeNativePortForward(profileId: string): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native port forwarding is available on Android only");
  }
  await bridge.removePortForward(profileId);
}

export function subscribeNativePortForwards(
  listener: (event: NativePortForwardEvent) => void,
): () => void {
  if (emitter === null || Platform.OS !== "android") {
    return () => {};
  }
  const subscription = emitter.addListener("CodeWidePortForwardEvent", (raw: unknown) => {
    try {
      const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
      listener(parseNativePortForwardEvent(value));
    } catch {
      appLogger.warn({ event: "native.port_forward_event.invalid" });
    }
  });
  return () => {
    subscription.remove();
  };
}

export async function openNativeTerminal(input: {
  cols: number;
  connectionId: string;
  cwd: string | null;
  rows: number;
  sessionId: string;
  threadId: string;
}): Promise<void> {
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    typeof bridge.openTerminal !== "function"
  ) {
    throw new Error("This app build does not include terminal support");
  }
  await bridge.openTerminal(
    input.sessionId,
    input.connectionId,
    input.threadId,
    input.cwd,
    input.cols,
    input.rows,
  );
}

export async function writeNativeTerminal(sessionId: string, base64: string): Promise<void> {
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    typeof bridge.writeTerminal !== "function"
  ) {
    throw new Error("This app build does not include terminal support");
  }
  await bridge.writeTerminal(sessionId, base64);
}

export async function resizeNativeTerminal(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    typeof bridge.resizeTerminal !== "function"
  ) {
    throw new Error("This app build does not include terminal support");
  }
  await bridge.resizeTerminal(sessionId, cols, rows);
}

export async function readNativeTerminalOutput(
  sessionId: string,
  offset: number,
  maxBytes = 256 * 1024,
): Promise<NativeTerminalOutput> {
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    typeof bridge.readTerminalOutput !== "function"
  ) {
    throw new Error("This app build does not include resumable terminal output");
  }
  const value: unknown = JSON.parse(await bridge.readTerminalOutput(sessionId, offset, maxBytes));
  const row = unknownRecord(value);
  if (row === null) {
    throw new Error("Native terminal output is invalid");
  }
  if (
    typeof row.data !== "string" ||
    typeof row.nextOffset !== "number" ||
    !Number.isSafeInteger(row.nextOffset) ||
    row.nextOffset < offset ||
    typeof row.hasMore !== "boolean" ||
    typeof row.finished !== "boolean"
  ) {
    throw new Error("Native terminal output is invalid");
  }
  return {
    data: row.data,
    finished: row.finished,
    hasMore: row.hasMore,
    nextOffset: row.nextOffset,
  };
}

export async function listNativeTerminals(): Promise<NativeTerminalSession[]> {
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    typeof bridge.listTerminals !== "function"
  ) {
    return [];
  }
  const value: unknown = JSON.parse(await bridge.listTerminals());
  if (!Array.isArray(value)) {
    throw new Error("Native terminal inventory is invalid");
  }
  return value.map(parseNativeTerminalSession);
}

export function parseNativeTerminalSession(value: unknown): NativeTerminalSession {
  const row = unknownRecord(value);
  if (row === null) {
    throw new Error("Native terminal inventory is invalid");
  }
  if (typeof row.sessionId !== "string" || !TERMINAL_SESSION_ID.test(row.sessionId)) {
    throw new Error("Native terminal inventory is invalid");
  }
  if (!isNonEmptyString(row.connectionId)) {
    throw new Error("Native terminal inventory is invalid");
  }
  if (!isBoundedTerminalThreadId(row.threadId)) {
    throw new Error("Native terminal inventory is invalid");
  }
  if (!isTerminalCwd(row.cwd)) {
    throw new Error("Native terminal inventory is invalid");
  }
  if (!isNativeTerminalStatus(row.status)) {
    throw new Error("Native terminal inventory is invalid");
  }
  return {
    connectionId: row.connectionId,
    cwd: row.cwd,
    sessionId: row.sessionId,
    status: row.status,
    threadId: row.threadId,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isBoundedTerminalThreadId(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= MAX_TERMINAL_THREAD_ID_LENGTH;
}

function isTerminalCwd(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && value.length > 0 && value.length <= MAX_TERMINAL_CWD_LENGTH)
  );
}

function isNativeTerminalStatus(value: unknown): value is NativeTerminalSession["status"] {
  return value === "connecting" || value === "open";
}

export function closeNativeTerminal(sessionId: string): void {
  bridge?.closeTerminal?.(sessionId);
}

export async function startLegacyNativeRuntimeResources(): Promise<void> {
  return bridge?.startLegacyRuntimeResources?.() ?? Promise.resolve();
}

export async function stopLegacyNativeRuntimeResources(): Promise<void> {
  return bridge?.stopLegacyRuntimeResources?.() ?? Promise.resolve();
}

export function subscribeNativeTerminal(
  listener: (event: NativeTerminalEvent) => void,
): () => void {
  if (emitter === null || Platform.OS !== "android") {
    return () => {};
  }
  const subscription = emitter.addListener("CodeWideTerminalEvent", (raw: unknown) => {
    try {
      const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
      listener(parseNativeTerminalEvent(value));
    } catch {
      appLogger.warn({ event: "native.terminal_event.invalid" });
    }
  });
  return () => {
    subscription.remove();
  };
}

function parseNativeTerminalEvent(value: unknown): NativeTerminalEvent {
  const row = unknownRecord(value);
  if (row === null) {
    throw new Error("Native terminal event is invalid");
  }
  if (
    typeof row.connectionId !== "string" ||
    row.connectionId.length === 0 ||
    typeof row.sessionId !== "string" ||
    row.sessionId.length === 0 ||
    typeof row.threadId !== "string" ||
    row.threadId.length === 0 ||
    !isNativeTerminalEventType(row.type) ||
    !(row.data === undefined || typeof row.data === "string") ||
    !(row.code === undefined || (typeof row.code === "number" && Number.isInteger(row.code))) ||
    !(row.message === undefined || typeof row.message === "string") ||
    !(
      row.offset === undefined ||
      (typeof row.offset === "number" && Number.isSafeInteger(row.offset) && row.offset >= 0)
    )
  ) {
    throw new Error("Native terminal event is invalid");
  }
  if (row.type === "output" && row.offset === undefined) {
    throw new Error("Native terminal output offset is missing");
  }
  return {
    connectionId: row.connectionId,
    sessionId: row.sessionId,
    threadId: row.threadId,
    type: row.type,
    ...(row.code === undefined ? {} : { code: row.code }),
    ...(row.data === undefined ? {} : { data: row.data }),
    ...(row.message === undefined ? {} : { message: row.message }),
    ...(row.offset === undefined ? {} : { offset: row.offset }),
  };
}

function isNativeTerminalEventType(value: unknown): value is NativeTerminalEvent["type"] {
  return (
    value === "connecting" ||
    value === "open" ||
    value === "output" ||
    value === "closed" ||
    value === "error" ||
    value === "removed"
  );
}

export function parseNativePortForwardProfile(value: unknown): NativePortForwardProfile {
  const row = unknownRecord(value);
  if (row === null) {
    throw new Error("Native port-forward projection is invalid");
  }
  if (
    typeof row.id !== "string" ||
    row.id.length === 0 ||
    typeof row.connectionId !== "string" ||
    row.connectionId.length === 0 ||
    typeof row.label !== "string" ||
    row.label.length === 0 ||
    row.remoteHost !== "127.0.0.1" ||
    !isPort(row.remotePort) ||
    !(row.preferredLocalPort === null || isPort(row.preferredLocalPort)) ||
    !(
      row.serviceKey === null ||
      (typeof row.serviceKey === "string" && /^[a-f0-9]{64}$/u.test(row.serviceKey))
    ) ||
    !isPortForwardingPreference(row.preference) ||
    !(row.localPort === null || isPort(row.localPort)) ||
    typeof row.enabled !== "boolean" ||
    !isPortForwardingStatus(row.status) ||
    // Native-136 uses raw loopback URLs; older shells retain the capability path.
    !(
      row.previewUrl === null ||
      (typeof row.previewUrl === "string" &&
        /^http:\/\/127\.0\.0\.1:\d+\/(?:[A-Za-z0-9_-]{43}\/)?$/u.test(row.previewUrl))
    ) ||
    !(row.error === null || typeof row.error === "string") ||
    typeof row.updatedAt !== "number"
  ) {
    throw new Error("Native port-forward projection is invalid");
  }
  return {
    connectionId: row.connectionId,
    enabled: row.enabled,
    error: row.error,
    id: row.id,
    label: row.label,
    localPort: row.localPort,
    preference: row.preference,
    preferredLocalPort: row.preferredLocalPort,
    previewUrl: row.previewUrl,
    remoteHost: row.remoteHost,
    remotePort: row.remotePort,
    serviceKey: row.serviceKey,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

function parseNativePortForwardEvent(value: unknown): NativePortForwardEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Native port-forward event is invalid");
  }
  const type = "type" in value ? value.type : undefined;
  if (type === "profile") {
    return {
      profile: parseNativePortForwardProfile("profile" in value ? value.profile : undefined),
      type,
    };
  }
  const id = "id" in value ? value.id : undefined;
  if (type === "removed" && typeof id === "string" && id.length > 0) {
    return { id, type };
  }
  const connectionId = "connectionId" in value ? value.connectionId : undefined;
  if (
    (type === "inventory" || type === "inventoryError") &&
    typeof connectionId === "string" &&
    connectionId.length > 0
  ) {
    return { connectionId, type };
  }
  throw new Error("Native port-forward event is invalid");
}

function parseNativeDiscoveredPort(value: unknown): NativeDiscoveredPort {
  const row = unknownRecord(value);
  if (row === null) {
    throw new Error("Native discovered port is invalid");
  }
  if (
    !isPort(row.port) ||
    typeof row.name !== "string" ||
    row.name.length === 0 ||
    typeof row.group !== "string" ||
    row.group.length === 0 ||
    typeof row.details !== "string" ||
    !(row.process === null || typeof row.process === "string") ||
    !(
      row.pid === null ||
      (typeof row.pid === "number" && Number.isSafeInteger(row.pid) && row.pid > 0)
    ) ||
    !(row.cwd === null || typeof row.cwd === "string") ||
    !isDiscoveredPortKind(row.kind) ||
    typeof row.forwardingKey !== "string" ||
    !/^[a-f0-9]{64}$/u.test(row.forwardingKey) ||
    typeof row.defaultForwardingEnabled !== "boolean"
  ) {
    throw new Error("Native discovered port is invalid");
  }
  return {
    cwd: row.cwd,
    defaultForwardingEnabled: row.defaultForwardingEnabled,
    details: row.details,
    forwardingKey: row.forwardingKey,
    group: row.group,
    kind: row.kind,
    name: row.name,
    pid: row.pid,
    port: row.port,
    process: row.process,
  };
}

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 65_535;
}

function isPortForwardingPreference(value: unknown): value is NativePortForwardingPreference {
  return value === "automatic" || value === "included" || value === "excluded";
}

function isPortForwardingStatus(value: unknown): value is NativePortForwardProfile["status"] {
  return (
    value === "stopped" ||
    value === "connecting" ||
    value === "live" ||
    value === "unavailable" ||
    value === "error"
  );
}

function isDiscoveredPortKind(value: unknown): value is NativeDiscoveredPort["kind"] {
  return (
    value === "docker" ||
    value === "hermes" ||
    value === "kubernetes" ||
    value === "minikube" ||
    value === "vite" ||
    value === "node" ||
    value === "python" ||
    value === "zrok" ||
    value === "process" ||
    value === "system"
  );
}

function parseNativeEnvelope(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  const envelope = unknownRecord(value);
  if (envelope === null) {
    throw new Error("Native command response is invalid");
  }
  return envelope;
}

function nativeEnvelopeError(
  envelope: Readonly<Record<string, unknown>>,
  fallback: string,
): string {
  return typeof envelope.message === "string" ? envelope.message : fallback;
}

function isNativeCommandDeliveryState(value: unknown): value is NativeCommandDelivery["state"] {
  return (
    value === "queued" ||
    value === "sending" ||
    value === "accepted" ||
    value === "uncertain" ||
    value === "failed" ||
    value === "delivered"
  );
}

// WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
// oxlint-disable-next-line eslint/max-params
export async function enqueueNativeCommand(
  connectionId: string,
  commandId: string,
  method: NativeCommandMethod,
  params: Record<string, unknown>,
): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native durable command queue is unavailable");
  }
  const raw = await bridge.engineEnqueueCommand(
    connectionId,
    commandId,
    method,
    JSON.stringify(params),
  );
  const envelope = parseNativeEnvelope(raw);
  if (envelope.ok !== true) {
    throw new Error(nativeEnvelopeError(envelope, "Could not persist native command"));
  }
}

export async function listNativeCommands(): Promise<NativeCommandDelivery[]> {
  if (bridge === undefined || Platform.OS !== "android") {
    return [];
  }
  const raw = await bridge.engineListCommands();
  const envelope = parseNativeEnvelope(raw);
  if (envelope.ok !== true || !Array.isArray(envelope.result)) {
    throw new Error(nativeEnvelopeError(envelope, "Could not read native commands"));
  }
  return envelope.result.map(parseNativeCommandDelivery);
}

export async function retryNativeCommand(
  connectionId: string,
  commandId: string,
): Promise<NativeCommandDelivery> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Native durable command queue is unavailable");
  }
  if (bridge.engineRetryCommand === undefined) {
    throw new Error("Retry requires the latest Android app version");
  }
  const raw = await bridge.engineRetryCommand(connectionId, commandId);
  const envelope = parseNativeEnvelope(raw);
  if (envelope.ok !== true) {
    throw new Error(nativeEnvelopeError(envelope, "Could not retry message"));
  }
  return parseNativeCommandDelivery(envelope.result);
}

/**
 * Retires the native receipt after the same prompt is present in the durable
 * authoritative projection. Older installed shells do not expose this bridge;
 * the UI projection can still reconcile it locally until the next APK update.
 */
export async function acknowledgeNativeCommandReceipt(
  connectionId: string,
  commandId: string,
): Promise<void> {
  if (
    bridge === undefined ||
    Platform.OS !== "android" ||
    bridge.engineAcknowledgeCommandReceipt === undefined
  ) {
    return;
  }
  await bridge.engineAcknowledgeCommandReceipt(connectionId, commandId);
}

export function parseNativeCommandDelivery(value: unknown): NativeCommandDelivery {
  const row = unknownRecord(value);
  if (row === null) {
    throw new Error("Native command projection is invalid");
  }
  const attachments = Array.isArray(row.attachments)
    ? row.attachments.filter((attachment: unknown): attachment is RemoteFileAttachment => {
        const record = unknownRecord(attachment);
        return (
          record !== null &&
          typeof record.id === "string" &&
          typeof record.rootId === "string" &&
          typeof record.path === "string" &&
          typeof record.name === "string" &&
          (record.kind === "image" || record.kind === "audio" || record.kind === "file")
        );
      })
    : [];
  if (
    typeof row.connectionId !== "string" ||
    typeof row.commandId !== "string" ||
    typeof row.method !== "string" ||
    !(row.threadId === null || typeof row.threadId === "string") ||
    !(row.targetCommandId === null || typeof row.targetCommandId === "string") ||
    typeof row.text !== "string" ||
    !isNativeCommandDeliveryState(row.state) ||
    typeof row.attempts !== "number" ||
    typeof row.createdAt !== "number" ||
    typeof row.updatedAt !== "number" ||
    !(row.lastError === null || typeof row.lastError === "string") ||
    !(
      row.workspaceRequestId === undefined ||
      row.workspaceRequestId === null ||
      typeof row.workspaceRequestId === "string"
    )
  ) {
    throw new Error("Native command projection is invalid");
  }
  return {
    attachments,
    attempts: row.attempts,
    commandId: row.commandId,
    connectionId: row.connectionId,
    createdAt: row.createdAt,
    lastError: row.lastError,
    method: row.method,
    state: row.state,
    targetCommandId: row.targetCommandId,
    text: row.text,
    threadId: row.threadId,
    updatedAt: row.updatedAt,
    ...(row.workspaceRequestId === undefined ? {} : { workspaceRequestId: row.workspaceRequestId }),
  };
}

export async function startVoiceRecognition(
  onEvent: (event: NativeVoiceEvent) => void,
  localeTag: string | null = null,
): Promise<() => void> {
  if (bridge === undefined || emitter === null || Platform.OS !== "android") {
    throw new Error("Native voice input is unavailable");
  }
  if (getMicrophonePermission() !== "granted") {
    throw new Error("Microphone permission is required");
  }
  let armed = false;
  let stopped = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const pendingEvents: NativeVoiceEvent[] = [];
  const cleanup = (stopNative: boolean) => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (watchdog !== undefined) {
      clearTimeout(watchdog);
    }
    watchdog = undefined;
    if (stopNative) {
      bridge.stopVoiceInput();
    }
    subscription.remove();
  };
  const deliver = (event: NativeVoiceEvent) => {
    if (stopped) {
      return;
    }
    onEvent(event);
    if (event.type === "final" || event.type === "error") {
      cleanup(true);
    }
  };
  const subscription = emitter.addListener("CodeWideVoiceEvent", (event: NativeVoiceEvent) => {
    if (!armed) {
      pendingEvents.push(event);
    } else {
      deliver(event);
    }
  });
  try {
    await bridge.startVoiceInput(localeTag);
  } catch (error) {
    cleanup(false);
    throw error;
  }
  watchdog = setTimeout(() => {
    deliver({ text: "timeout", type: "error" });
  }, 30_000);
  setTimeout(() => {
    if (stopped) {
      return;
    }
    armed = true;
    for (const event of pendingEvents.splice(0)) {
      deliver(event);
    }
  }, 0);
  return () => {
    cleanup(true);
  };
}

export function cancelVoiceRecognition(): void {
  bridge?.stopVoiceInput();
}

export function setNativeVoiceAuraState(
  active: boolean,
  level: number,
  reducedMotion: boolean,
): void {
  if (bridge === undefined || Platform.OS !== "android" || bridge.setVoiceAuraState === undefined) {
    return;
  }
  bridge.setVoiceAuraState(active, Math.max(0, Math.min(1, level)), reducedMotion);
}

/** Capture the pressed microphone's native center before focus/keyboard changes. */
export function setNativeVoiceAuraOrigin(reactTag: number | null): void {
  if (bridge === undefined || Platform.OS !== "android") {
    return;
  }
  bridge.setVoiceAuraOrigin?.(reactTag);
}

export function configureNativeFullscreenWindow(reactTag: number): void {
  bridge?.configureFullscreenWindow?.(reactTag);
}

export async function startPcmCapture(
  lease: NativeMicrophoneLease,
  onChunk: (chunk: CapturedAudioChunk) => void,
  onError: (message: string) => void,
): Promise<{ info: PcmCaptureInfo | null; stop: () => Promise<void> }> {
  if (bridge === undefined || emitter === null || Platform.OS !== "android") {
    throw new Error("Native audio capture is unavailable");
  }
  if (getMicrophonePermission() !== "granted") {
    throw new Error("Microphone permission is required");
  }
  let stopped = false;
  let stopPromise: Promise<void> | null = null;
  let resolveStopped: (() => void) | null = null;
  const subscription = emitter.addListener("CodeWideAudioEvent", (event: NativeAudioEvent) => {
    if (event.type === "chunk") {
      onChunk(event);
    } else if (event.type === "error") {
      onError(event.error ?? "audio_capture_failed");
    } else if (event.type === "stopped") {
      stopped = true;
      subscription.remove();
      resolveStopped?.();
    }
  });
  try {
    const capture = await bridge.startPcmCapture(lease.token, lease.purpose);
    const info = isPcmCaptureInfo(capture) ? capture : null;
    if (info !== null) {
      appLogger.info({
        event: "microphone.capture_started",
        fields: {
          acousticEchoCancelerEnabled: info.acousticEchoCancelerEnabled,
          acousticEchoCancelerSupported: info.acousticEchoCancelerSupported,
          automaticGainControl: info.automaticGainControl,
          noiseSuppressor: info.noiseSuppressor,
          sampleRate: info.sampleRate,
          source: info.source,
        },
      });
    } else {
      appLogger.info({ event: "microphone.legacy_capture_started" });
    }
    return {
      info,
      stop: async () => {
        if (stopped) {
          return;
        }
        if (stopPromise !== null) {
          await stopPromise;
          return;
        }
        const stoppedEvent = new Promise<void>((resolve) => {
          resolveStopped = resolve;
        });
        const attempt = (async () => {
          await bridge.stopPcmCapture(lease.token, lease.purpose);
          await stoppedEvent;
        })();
        stopPromise = attempt;
        try {
          await attempt;
        } catch (error) {
          if (stopPromise === attempt) {
            stopPromise = null;
            resolveStopped = null;
          }
          throw error;
        }
      },
    };
  } catch (error) {
    stopped = true;
    subscription.remove();
    throw error;
  }
}

function isPcmCaptureInfo(value: unknown): value is PcmCaptureInfo {
  const info = unknownRecord(value);
  if (info === null) {
    return false;
  }
  return (
    typeof info.sampleRate === "number" &&
    Number.isSafeInteger(info.sampleRate) &&
    info.sampleRate >= 8000 &&
    info.sampleRate <= 96_000 &&
    (info.source === "voice_recognition" ||
      info.source === "voice_communication" ||
      info.source === "mic") &&
    typeof info.acousticEchoCancelerEnabled === "boolean" &&
    typeof info.acousticEchoCancelerSupported === "boolean" &&
    typeof info.noiseSuppressor === "boolean" &&
    typeof info.automaticGainControl === "boolean"
  );
}
