import type { RemoteFileAttachment } from "@codewide/sync-client";

/** Speech-recognition event emitted by the native voice transport. */
export type NativeVoiceEvent = {
  text?: string;
  type: "ready" | "speechStart" | "speechEnd" | "partial" | "final" | "error";
};

/** Base64-encoded PCM audio frame captured by the native microphone. */
export type PcmAudioChunk = {
  data: string;
  encoding?: "pcm_s16le";
  level: number;
  numChannels: number;
  sampleRate: number;
  samplesPerChannel: number;
};

/** Base64-encoded Opus audio frame captured by the native microphone. */
export type OpusAudioChunk = {
  data: string;
  encoding: "opus";
  level: number;
  numChannels: number;
  sampleRate: number;
  samplesPerChannel: number;
};

/** Audio frame accepted by the voice-upload boundary. */
export type CapturedAudioChunk = PcmAudioChunk | OpusAudioChunk;

/** Native PCM capture parameters selected for the active microphone session. */
export type PcmCaptureInfo = {
  automaticGainControl: boolean;
  noiseSuppressor: boolean;
  sampleRate: number;
  source: "voice_recognition" | "voice_communication" | "mic";
};

/** Validated server configuration passed into the native connection runtime. */
export type NativeConnectionConfig = {
  connectionId: string;
  deviceId: string | null;
  enabled: boolean;
  endpoint: string;
  savedServerId: string;
  tlsPinSha256: string | null;
};

/** Local endpoint credentials for the embedded browser DevTools bridge. */
export type NativeBrowserDevToolsBridge = {
  host: "127.0.0.1";
  port: number;
  token: string;
  tracingSupported: boolean;
};

/** Local trace artifact produced by the embedded browser runtime. */
export type NativeBrowserTrace = {
  path: string;
  size: number;
};

/** Native representation of one configured port-forwarding profile. */
export type NativePortForwardProfile = {
  connectionId: string;
  enabled: boolean;
  error: string | null;
  id: string;
  label: string;
  localPort: number | null;
  preference: NativePortForwardingPreference;
  preferredLocalPort: number | null;
  previewUrl: string | null;
  remoteHost: "127.0.0.1";
  remotePort: number;
  serviceKey: string | null;
  status: "stopped" | "connecting" | "live" | "unavailable" | "error";
  updatedAt: number;
};

/** Native forwarding policy persisted for a discovered port. */
export type NativePortForwardingPreference = "automatic" | "included" | "excluded";

/** Port inventory or profile mutation emitted by the native forwarding runtime. */
export type NativePortForwardEvent =
  | { connectionId: string; type: "inventory" | "inventoryError" }
  | { profile: NativePortForwardProfile; type: "profile" }
  | { id: string; type: "removed" };

/** Lifecycle or output event emitted for one native terminal session. */
export type NativeTerminalEvent = {
  code?: number;
  connectionId: string;
  data?: string;
  message?: string;
  offset?: number;
  sessionId: string;
  threadId: string;
  type: "connecting" | "open" | "output" | "closed" | "error" | "removed";
};

/** Bounded terminal output page returned by the native transport. */
export type NativeTerminalOutput = {
  data: string;
  finished: boolean;
  hasMore: boolean;
  nextOffset: number;
};

/** Listening port discovered by the Companion through native transport. */
export type NativeDiscoveredPort = {
  cwd: string | null;
  defaultForwardingEnabled: boolean;
  details: string;
  forwardingKey: string;
  group: string;
  kind:
    | "docker"
    | "hermes"
    | "kubernetes"
    | "minikube"
    | "vite"
    | "node"
    | "python"
    | "zrok"
    | "process"
    | "system";
  name: string;
  pid: number | null;
  port: number;
  process: string | null;
};

/** Correlation metadata returned when native transport accepts a command. */
export type NativeCommandDelivery = {
  attachments: RemoteFileAttachment[];
  attempts: number;
  commandId: string;
  connectionId: string;
  createdAt: number;
  lastError: string | null;
  method: string;
  state: "queued" | "sending" | "accepted" | "uncertain" | "failed" | "delivered";
  targetCommandId: string | null;
  text: string;
  threadId: string | null;
  updatedAt: number;
  workspaceRequestId?: string | null;
};

/** Stable application projection of the native microphone permission. */
export type MicrophonePermission = "granted" | "denied" | "blocked";

/** Command methods supported by the V1 native transport boundary. */
export type NativeCommandMethod =
  | "turn/start"
  | "turn/steer"
  | "thread/name/set"
  | "thread/archive"
  | "thread/unarchive"
  | "thread/delete"
  | "thread/settings/update"
  | "turn/interrupt"
  | "serverRequest/respond"
  | "companion/queue/put"
  | "companion/queue/edit"
  | "companion/queue/cancel"
  | "companion/queue/move"
  | "companion/queue/retry"
  | "companion/queue/steer";
