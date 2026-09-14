import type { RemoteFileAttachment } from "@codewide/sync-client";

export type NativeVoiceEvent = {
  type: "ready" | "speechStart" | "speechEnd" | "partial" | "final" | "error";
  text?: string;
};

export type PcmAudioChunk = {
  encoding?: "pcm_s16le";
  data: string;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel: number;
  level: number;
};

export type OpusAudioChunk = {
  encoding: "opus";
  data: string;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel: number;
  level: number;
};

export type CapturedAudioChunk = PcmAudioChunk | OpusAudioChunk;

export type PcmCaptureInfo = {
  sampleRate: number;
  source: "voice_recognition" | "voice_communication" | "mic";
  noiseSuppressor: boolean;
  automaticGainControl: boolean;
};

export type NativeConnectionConfig = {
  connectionId: string;
  savedServerId: string;
  endpoint: string;
  tlsPinSha256: string | null;
  enabled: boolean;
  deviceId: string | null;
};

export type NativeBrowserDevToolsBridge = {
  host: "127.0.0.1";
  port: number;
  token: string;
  tracingSupported: boolean;
};

export type NativeBrowserTrace = {
  path: string;
  size: number;
};

export type NativePortForwardProfile = {
  id: string;
  connectionId: string;
  label: string;
  remoteHost: "127.0.0.1";
  remotePort: number;
  preferredLocalPort: number | null;
  serviceKey: string | null;
  preference: NativePortForwardingPreference;
  localPort: number | null;
  enabled: boolean;
  status: "stopped" | "connecting" | "live" | "unavailable" | "error";
  previewUrl: string | null;
  error: string | null;
  updatedAt: number;
};

export type NativePortForwardingPreference = "automatic" | "included" | "excluded";

export type NativePortForwardEvent =
  | { type: "inventory" | "inventoryError"; connectionId: string }
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

export type NativeTerminalOutput = {
  data: string;
  nextOffset: number;
  hasMore: boolean;
  finished: boolean;
};

export type NativeDiscoveredPort = {
  port: number;
  name: string;
  group: string;
  details: string;
  process: string | null;
  pid: number | null;
  cwd: string | null;
  kind: "docker" | "hermes" | "kubernetes" | "minikube" | "vite" | "node" | "python" | "zrok" | "process" | "system";
  forwardingKey: string;
  defaultForwardingEnabled: boolean;
};

export type NativeCommandDelivery = {
  connectionId: string;
  commandId: string;
  method: string;
  threadId: string | null;
  targetCommandId: string | null;
  text: string;
  attachments: RemoteFileAttachment[];
  workspaceRequestId?: string | null;
  state: "queued" | "sending" | "accepted" | "uncertain" | "failed" | "delivered";
  attempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type MicrophonePermission = "granted" | "denied" | "blocked";

export type NativeCommandMethod =
  | "turn/start" | "turn/steer" | "thread/name/set" | "thread/archive" | "thread/unarchive" | "thread/delete"
  | "thread/settings/update" | "turn/interrupt" | "serverRequest/respond"
  | "companion/queue/put" | "companion/queue/edit" | "companion/queue/cancel"
  | "companion/queue/move" | "companion/queue/retry" | "companion/queue/steer";
