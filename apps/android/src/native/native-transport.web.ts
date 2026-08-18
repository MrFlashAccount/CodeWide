export async function claimNativePairing(): Promise<{ deviceId: string; capabilityToken: string }> {
  throw new Error("Native secure pairing is available on Android only");
}

export async function mintNativeSession(): Promise<{ sessionToken: string; expiresAt: number }> {
  throw new Error("Native session proof is available on Android only");
}

export async function saveNativeConnectionCredentials(): Promise<void> {
  throw new Error("Native credential storage is available on Android only");
}

export type NativeConnectionConfig = {
  connectionId: string;
  endpoint: string;
  tlsPinSha256: string | null;
  enabled: boolean;
};
export type NativePortForwardProfile = {
  id: string;
  connectionId: string;
  label: string;
  remoteHost: "127.0.0.1";
  remotePort: number;
  preferredLocalPort: number | null;
  localPort: number | null;
  enabled: boolean;
  status: "stopped" | "connecting" | "live" | "error";
  previewUrl: string | null;
  error: string | null;
  updatedAt: number;
};
export type NativePortForwardEvent =
  | { type: "profile"; profile: NativePortForwardProfile }
  | { type: "removed"; id: string };
export type NativeTerminalEvent = {
  sessionId: string;
  connectionId: string;
  threadId: string;
  type: "connecting" | "open" | "output" | "closed" | "error" | "removed";
  data?: string;
  code?: number;
  message?: string;
  offset?: number;
};
export type NativeTerminalOutput = { data: string; nextOffset: number; hasMore: boolean; finished: boolean };
export type NativeDiscoveredPort = {
  port: number;
  name: string;
  process: string | null;
  pid: number | null;
  cwd: string | null;
  kind: "web" | "node" | "python" | "container" | "service";
};
export async function listNativeConnectionConfigs(): Promise<NativeConnectionConfig[]> { return []; }
export async function purgeLegacyDerivedStorage(): Promise<number> { return 0; }
export async function deleteNativeConnection(): Promise<void> { throw new Error("Android only"); }

export async function setNativeConnectionEnabled(): Promise<void> {
  throw new Error("Native connection lifecycle is available on Android only");
}

export function reconnectNativeConnection(_connectionId: string): void { throw new Error("Android only"); }
export function wakeNativeConnection(_connectionId: string): void {}
export async function listNativePortForwards(): Promise<NativePortForwardProfile[]> { return []; }
export async function discoverNativePorts(): Promise<{ ports: NativeDiscoveredPort[]; scannedAt: number }> { return { ports: [], scannedAt: Date.now() }; }
export async function upsertNativePortForward(): Promise<NativePortForwardProfile> { throw new Error("Android only"); }
export async function startNativePortForward(): Promise<NativePortForwardProfile> { throw new Error("Android only"); }
export async function stopNativePortForward(): Promise<NativePortForwardProfile> { throw new Error("Android only"); }
export async function removeNativePortForward(): Promise<void> { throw new Error("Android only"); }
export function subscribeNativePortForwards(): () => void { return () => {}; }
export async function openNativeTerminal(): Promise<void> { throw new Error("Terminal is available on Android only"); }
export async function writeNativeTerminal(): Promise<void> { throw new Error("Terminal is available on Android only"); }
export async function resizeNativeTerminal(): Promise<void> { throw new Error("Terminal is available on Android only"); }
export async function readNativeTerminalOutput(): Promise<NativeTerminalOutput> { throw new Error("Terminal is available on Android only"); }
export function closeNativeTerminal(): void {}
export function subscribeNativeTerminal(): () => void { return () => {}; }
export async function enqueueNativeCommand(): Promise<void> { throw new Error("Android only"); }
export type NativeCommandDelivery = {
  connectionId: string;
  commandId: string;
  method: string;
  threadId: string | null;
  targetCommandId: string | null;
  text: string;
  attachments: import("@codewide/sync-client").RemoteFileAttachment[];
  state: "queued" | "sending" | "accepted" | "uncertain" | "failed" | "delivered";
  attempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};
export async function listNativeCommands(): Promise<NativeCommandDelivery[]> { return []; }
export async function retryNativeCommand(): Promise<NativeCommandDelivery> { throw new Error("Android only"); }
export async function acknowledgeNativeCommandReceipt(): Promise<void> {}

export async function startVoiceRecognition(): Promise<() => void> {
  throw new Error("Native voice input is available on Android only");
}

export function cancelVoiceRecognition(): void {}

export type PcmAudioChunk = {
  data: string;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel: number;
  level: number;
};

export async function startPcmCapture(): Promise<{ stop(): void; info: null }> {
  throw new Error("Native audio capture is available on Android only");
}

export function stopPcmCapture(): void {}
