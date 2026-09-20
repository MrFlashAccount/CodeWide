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

const RESOLVED_VOID_PROMISE = Promise.resolve();

// WHY: Unsupported web capabilities must reject asynchronously instead of throwing before callers receive a Promise.
// oxlint-disable-next-line typescript/require-await
async function androidOnly(message: string): Promise<never> {
  throw new Error(message);
}

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
export async function claimNativePairing(_input: {
  deviceName: string;
  endpoint: string;
  pairingToken: string;
  savedServerId: string;
  tlsPinSha256: string;
}): Promise<{ capabilityToken: string; deviceId: string }> {
  const unavailable = await androidOnly("Native secure pairing is available on Android only");
  return unavailable;
}

export async function mintNativeSession(
  _connectionId: string,
): Promise<{ expiresAt: number; sessionToken: string }> {
  const unavailable = await androidOnly("Native session proof is available on Android only");
  return unavailable;
}

export async function saveNativeConnectionCredentials(_input: {
  connectionId: string;
  deviceId?: string;
  enabled: boolean;
  endpoint: string;
  tlsPinSha256?: string;
  token?: string;
}): Promise<void> {
  const unavailable = await androidOnly("Native credential storage is available on Android only");
  return unavailable;
}

export async function listNativeConnectionConfigs(): Promise<NativeConnectionConfig[]> {
  await RESOLVED_VOID_PROMISE;
  return [];
}
export async function nativeCompanionHttpOrigin(
  _connectionId: string,
  endpoint: string,
): Promise<string> {
  await RESOLVED_VOID_PROMISE;
  const url = new URL(endpoint);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}
export async function purgeLegacyDerivedStorage(): Promise<number> {
  await RESOLVED_VOID_PROMISE;
  return 0;
}
export async function startNativeBrowserDevToolsBridge(): Promise<NativeBrowserDevToolsBridge> {
  const unavailable = await androidOnly("Chromium DevTools are available on Android only");
  return unavailable;
}
export function stopNativeBrowserDevToolsBridge(): void {}
export async function startNativeBrowserTracing(): Promise<void> {
  const unavailable = await androidOnly("Browser tracing is available on Android only");
  return unavailable;
}
export async function stopNativeBrowserTracing(): Promise<NativeBrowserTrace> {
  const unavailable = await androidOnly("Browser tracing is available on Android only");
  return unavailable;
}
export async function deleteNativeConnection(_connectionId: string): Promise<void> {
  const unavailable = await androidOnly("Android only");
  return unavailable;
}

export async function setNativeConnectionEnabled(
  _connectionId: string,
  _enabled: boolean,
): Promise<void> {
  const unavailable = await androidOnly("Native connection lifecycle is available on Android only");
  return unavailable;
}

export function reconnectNativeConnection(_connectionId: string): void {
  throw new Error("Android only");
}
export function wakeNativeConnection(_connectionId: string): void {}
export async function listNativePortForwards(
  _connectionId: string,
): Promise<NativePortForwardProfile[]> {
  await RESOLVED_VOID_PROMISE;
  return [];
}
export async function discoverNativePorts(
  _connectionId: string,
): Promise<{ ports: NativeDiscoveredPort[]; scannedAt: number }> {
  await RESOLVED_VOID_PROMISE;
  return { ports: [], scannedAt: Date.now() };
}
export async function upsertNativePortForward(_input: {
  connectionId: string;
  label: string;
  preference?: NativePortForwardingPreference;
  preferredLocalPort: number | null;
  profileId: string;
  remotePort: number;
  serviceKey?: string | null;
}): Promise<NativePortForwardProfile> {
  const unavailable = await androidOnly("Android only");
  return unavailable;
}
export async function startNativePortForward(
  _profileId: string,
): Promise<NativePortForwardProfile> {
  const unavailable = await androidOnly("Android only");
  return unavailable;
}
export async function stopNativePortForward(_profileId: string): Promise<NativePortForwardProfile> {
  const unavailable = await androidOnly("Android only");
  return unavailable;
}
export async function removeNativePortForward(_profileId: string): Promise<void> {
  const unavailable = await androidOnly("Android only");
  return unavailable;
}
export function subscribeNativePortForwards(
  _listener: (event: NativePortForwardEvent) => void,
): () => void {
  return () => {};
}
export async function openNativeTerminal(_input: {
  cols: number;
  connectionId: string;
  cwd: string | null;
  rows: number;
  sessionId: string;
  threadId: string;
}): Promise<void> {
  const unavailable = await androidOnly("Terminal is available on Android only");
  return unavailable;
}
export async function writeNativeTerminal(_sessionId: string, _base64: string): Promise<void> {
  const unavailable = await androidOnly("Terminal is available on Android only");
  return unavailable;
}
export async function resizeNativeTerminal(
  _sessionId: string,
  _cols: number,
  _rows: number,
): Promise<void> {
  const unavailable = await androidOnly("Terminal is available on Android only");
  return unavailable;
}
export async function readNativeTerminalOutput(
  _sessionId: string,
  _offset: number,
  _maxBytes = 256 * 1024,
): Promise<NativeTerminalOutput> {
  const unavailable = await androidOnly("Terminal is available on Android only");
  return unavailable;
}
export async function listNativeTerminals(): Promise<NativeTerminalSession[]> {
  await RESOLVED_VOID_PROMISE;
  return [];
}
export function closeNativeTerminal(_sessionId: string): void {}
export async function startLegacyNativeRuntimeResources(): Promise<void> {
  await RESOLVED_VOID_PROMISE;
}
export async function stopLegacyNativeRuntimeResources(): Promise<void> {
  await RESOLVED_VOID_PROMISE;
}
export function subscribeNativeTerminal(
  _listener: (event: NativeTerminalEvent) => void,
): () => void {
  return () => {};
}

export async function enqueueNativeCommand(
  _connectionId: string,
  _commandId: string,
  _method: NativeCommandMethod,
  _params: Record<string, unknown>,
): Promise<void> {
  const unavailable = await androidOnly("Android only");
  return unavailable;
}

export async function listNativeCommands(): Promise<NativeCommandDelivery[]> {
  await RESOLVED_VOID_PROMISE;
  return [];
}
export async function retryNativeCommand(
  _connectionId: string,
  _commandId: string,
): Promise<NativeCommandDelivery> {
  const unavailable = await androidOnly("Android only");
  return unavailable;
}
export async function acknowledgeNativeCommandReceipt(
  _connectionId: string,
  _commandId: string,
): Promise<void> {
  await RESOLVED_VOID_PROMISE;
}

export function getMicrophonePermission(): MicrophonePermission {
  return "granted";
}
export function subscribeMicrophonePermission(_notify: () => void): () => void {
  return () => {};
}
export async function requestMicrophonePermission(): Promise<MicrophonePermission> {
  await RESOLVED_VOID_PROMISE;
  return "granted";
}

export async function startVoiceRecognition(
  _onEvent: (event: NativeVoiceEvent) => void,
  _localeTag: string | null = null,
): Promise<() => void> {
  const unavailable = await androidOnly("Native voice input is available on Android only");
  return unavailable;
}

export function cancelVoiceRecognition(): void {}

export function setNativeVoiceAuraOrigin(_reactTag: number | null): void {}

export async function startPcmCapture(
  _lease: NativeMicrophoneLease,
  _onChunk: (chunk: CapturedAudioChunk) => void,
  _onError: (message: string) => void,
): Promise<{ info: PcmCaptureInfo; stop: () => Promise<void> }> {
  const unavailable = await androidOnly("Native audio capture is available on Android only");
  return unavailable;
}

export function configureNativeFullscreenWindow(_reactTag: number): void {}
