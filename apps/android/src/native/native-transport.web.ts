import type { NativeVoiceEvent, CapturedAudioChunk, PcmCaptureInfo, NativeConnectionConfig, NativeBrowserDevToolsBridge, NativeBrowserTrace, NativePortForwardProfile, NativePortForwardingPreference, NativePortForwardEvent, NativeTerminalEvent, NativeTerminalOutput, NativeDiscoveredPort, NativeCommandDelivery, MicrophonePermission, NativeCommandMethod } from "./native-transport-contract";
export type { NativeVoiceEvent, PcmAudioChunk, OpusAudioChunk, CapturedAudioChunk, PcmCaptureInfo, NativeConnectionConfig, NativeBrowserDevToolsBridge, NativeBrowserTrace, NativePortForwardProfile, NativePortForwardingPreference, NativePortForwardEvent, NativeTerminalEvent, NativeTerminalOutput, NativeDiscoveredPort, NativeCommandDelivery, MicrophonePermission, NativeCommandMethod } from "./native-transport-contract";
export async function claimNativePairing(_input: {
  savedServerId: string;
  endpoint: string;
  pairingToken: string;
  deviceName: string;
  tlsPinSha256: string;
}): Promise<{ deviceId: string; capabilityToken: string }> {
  throw new Error("Native secure pairing is available on Android only");
}

export async function mintNativeSession(_connectionId: string): Promise<{ sessionToken: string; expiresAt: number }> {
  throw new Error("Native session proof is available on Android only");
}

export async function saveNativeConnectionCredentials(_input: {
  connectionId: string;
  endpoint: string;
  token?: string;
  tlsPinSha256?: string;
  enabled: boolean;
  deviceId?: string;
}): Promise<void> {
  throw new Error("Native credential storage is available on Android only");
}

export async function listNativeConnectionConfigs(): Promise<NativeConnectionConfig[]> { return []; }
export async function nativeCompanionHttpOrigin(_connectionId: string, endpoint: string): Promise<string> {
  const url = new URL(endpoint);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}
export async function purgeLegacyDerivedStorage(): Promise<number> { return 0; }
export async function startNativeBrowserDevToolsBridge(): Promise<NativeBrowserDevToolsBridge> { throw new Error("Chromium DevTools are available on Android only"); }
export function stopNativeBrowserDevToolsBridge(): void {}
export async function startNativeBrowserTracing(): Promise<void> { throw new Error("Browser tracing is available on Android only"); }
export async function stopNativeBrowserTracing(): Promise<NativeBrowserTrace> { throw new Error("Browser tracing is available on Android only"); }
export async function deleteNativeConnection(_connectionId: string): Promise<void> { throw new Error("Android only"); }

export async function setNativeConnectionEnabled(_connectionId: string, _enabled: boolean): Promise<void> {
  throw new Error("Native connection lifecycle is available on Android only");
}

export function reconnectNativeConnection(_connectionId: string): void { throw new Error("Android only"); }
export function wakeNativeConnection(_connectionId: string): void {}
export async function listNativePortForwards(_connectionId: string): Promise<NativePortForwardProfile[]> { return []; }
export async function discoverNativePorts(_connectionId: string): Promise<{ ports: NativeDiscoveredPort[]; scannedAt: number }> { return { ports: [], scannedAt: Date.now() }; }
export async function upsertNativePortForward(_input: {
  connectionId: string;
  profileId: string;
  label: string;
  remotePort: number;
  preferredLocalPort: number | null;
  serviceKey?: string | null;
  preference?: NativePortForwardingPreference;
}): Promise<NativePortForwardProfile> { throw new Error("Android only"); }
export async function startNativePortForward(_profileId: string): Promise<NativePortForwardProfile> { throw new Error("Android only"); }
export async function stopNativePortForward(_profileId: string): Promise<NativePortForwardProfile> { throw new Error("Android only"); }
export async function removeNativePortForward(_profileId: string): Promise<void> { throw new Error("Android only"); }
export function subscribeNativePortForwards(_listener: (event: NativePortForwardEvent) => void): () => void { return () => {}; }
export async function openNativeTerminal(_input: {
  sessionId: string;
  connectionId: string;
  threadId: string;
  cwd: string | null;
  cols: number;
  rows: number;
}): Promise<void> { throw new Error("Terminal is available on Android only"); }
export async function writeNativeTerminal(_sessionId: string, _base64: string): Promise<void> { throw new Error("Terminal is available on Android only"); }
export async function resizeNativeTerminal(_sessionId: string, _cols: number, _rows: number): Promise<void> { throw new Error("Terminal is available on Android only"); }
export async function readNativeTerminalOutput(_sessionId: string, _offset: number, _maxBytes = 256 * 1024): Promise<NativeTerminalOutput> { throw new Error("Terminal is available on Android only"); }
export function closeNativeTerminal(_sessionId: string): void {}
export function startLegacyNativeRuntimeResources(): Promise<void> { return Promise.resolve(); }
export function stopLegacyNativeRuntimeResources(): Promise<void> { return Promise.resolve(); }
export function subscribeNativeTerminal(_listener: (event: NativeTerminalEvent) => void): () => void { return () => {}; }

export async function enqueueNativeCommand(_connectionId: string, _commandId: string, _method: NativeCommandMethod, _params: Record<string, unknown>): Promise<void> { throw new Error("Android only"); }

export async function listNativeCommands(): Promise<NativeCommandDelivery[]> { return []; }
export async function retryNativeCommand(_connectionId: string, _commandId: string): Promise<NativeCommandDelivery> { throw new Error("Android only"); }
export async function acknowledgeNativeCommandReceipt(_connectionId: string, _commandId: string): Promise<void> {}

export function getMicrophonePermission(): MicrophonePermission { return "granted"; }
export function subscribeMicrophonePermission(_notify: () => void): () => void { return () => {}; }
export async function requestMicrophonePermission(): Promise<MicrophonePermission> { return "granted"; }

export async function startVoiceRecognition(_onEvent: (event: NativeVoiceEvent) => void, _localeTag: string | null = null): Promise<() => void> {
  throw new Error("Native voice input is available on Android only");
}

export function cancelVoiceRecognition(): void {}

export function setNativeVoiceAuraOrigin(_reactTag: number | null): void {}

export async function startPcmCapture(_onChunk: (chunk: CapturedAudioChunk) => void, _onError: (message: string) => void): Promise<{ stop(): Promise<void>; info: PcmCaptureInfo }> {
  throw new Error("Native audio capture is available on Android only");
}

export function stopPcmCapture(): void {}
export function configureNativeFullscreenWindow(_reactTag: number): void {}
