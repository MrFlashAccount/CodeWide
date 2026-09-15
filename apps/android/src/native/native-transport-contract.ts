import type { RemoteFileAttachment } from "@codewide/sync-client";

/** Speech-recognition event emitted by the native voice transport. */
export type NativeVoiceEvent = {
  type: "ready" | "speechStart" | "speechEnd" | "partial" | "final" | "error";
  text?: string;
};

/** Base64-encoded PCM audio frame captured by the native microphone. */
export type PcmAudioChunk = {
  encoding?: "pcm_s16le";
  data: string;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel: number;
  level: number;
};

/** Base64-encoded Opus audio frame captured by the native microphone. */
export type OpusAudioChunk = {
  encoding: "opus";
  data: string;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel: number;
  level: number;
};

/** Audio frame accepted by the voice-upload boundary. */
export type CapturedAudioChunk = PcmAudioChunk | OpusAudioChunk;

/** Native PCM capture parameters selected for the active microphone session. */
export type PcmCaptureInfo = {
  sampleRate: number;
  source: "voice_recognition" | "voice_communication" | "mic";
  noiseSuppressor: boolean;
  automaticGainControl: boolean;
};

/** Validated server configuration passed into the native connection runtime. */
export type NativeConnectionConfig = {
  connectionId: string;
  savedServerId: string;
  endpoint: string;
  tlsPinSha256: string | null;
  enabled: boolean;
  deviceId: string | null;
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

/** Native forwarding policy persisted for a discovered port. */
export type NativePortForwardingPreference = "automatic" | "included" | "excluded";

/** Port inventory or profile mutation emitted by the native forwarding runtime. */
export type NativePortForwardEvent =
  | { type: "inventory" | "inventoryError"; connectionId: string }
  | { type: "profile"; profile: NativePortForwardProfile }
  | { type: "removed"; id: string };

/** Lifecycle or output event emitted for one native terminal session. */
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

/** Bounded terminal output page returned by the native transport. */
export type NativeTerminalOutput = {
  data: string;
  nextOffset: number;
  hasMore: boolean;
  finished: boolean;
};

/** Listening port discovered by the Companion through native transport. */
export type NativeDiscoveredPort = {
  port: number;
  name: string;
  group: string;
  details: string;
  process: string | null;
  pid: number | null;
  cwd: string | null;
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
  forwardingKey: string;
  defaultForwardingEnabled: boolean;
};

/** Correlation metadata returned when native transport accepts a command. */
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
