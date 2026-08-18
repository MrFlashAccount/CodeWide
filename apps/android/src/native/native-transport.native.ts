import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from "react-native";
import type { RemoteFileAttachment } from "@codewide/sync-client";

type NativeVoiceEvent = {
  type: "ready" | "speechStart" | "speechEnd" | "partial" | "final" | "error";
  text?: string;
};

export type PcmAudioChunk = {
  data: string;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel: number;
  level: number;
};

type NativeAudioEvent = PcmAudioChunk & {
  type: "started" | "chunk" | "stopped" | "error";
  error?: string;
};

type NativeBridge = {
  claimPairing(endpoint: string, pairingToken: string, deviceName: string, tlsPinSha256: string | null): Promise<{ deviceId: string; capabilityToken: string }>;
  saveConnectionCredentials(connectionId: string, endpoint: string, token: string | null, tlsPinSha256: string | null, enabled: boolean): Promise<void>;
  listConnectionConfigs(): Promise<NativeConnectionConfig[]>;
  purgeLegacyDerivedStorage?(): Promise<number>;
  deleteConnectionCredentials(connectionId: string): Promise<void>;
  setConnectionEnabled(connectionId: string, enabled: boolean): Promise<void>;
  mintStoredSession(connectionId: string): Promise<{ sessionToken: string; expiresAt: number }>;
  resetSocket(connectionId: string, reason: string): void;
  wakeSocket(connectionId: string): void;
  listPortForwards?(connectionId: string): Promise<string>;
  discoverPorts?(connectionId: string): Promise<string>;
  upsertPortForward(
    connectionId: string,
    profileId: string,
    label: string,
    remotePort: number,
    preferredLocalPort: number | null,
  ): Promise<string>;
  startPortForward(profileId: string): Promise<string>;
  stopPortForward(profileId: string): Promise<string>;
  removePortForward(profileId: string): Promise<void>;
  openTerminal?(sessionId: string, connectionId: string, cwd: string | null, cols: number, rows: number): Promise<void>;
  writeTerminal?(sessionId: string, base64: string): Promise<void>;
  resizeTerminal?(sessionId: string, cols: number, rows: number): Promise<void>;
  closeTerminal?(sessionId: string): void;
  engineEnqueueCommand(connectionId: string, commandId: string, method: string, paramsJson: string): Promise<string>;
  engineListCommands(): Promise<string>;
  engineRetryCommand?(connectionId: string, commandId: string): Promise<string>;
  engineAcknowledgeCommandReceipt?(connectionId: string, commandId: string): Promise<void>;
  startVoiceInput(localeTag: string | null): Promise<void>;
  stopVoiceInput(): void;
  setVoiceAuraState?(active: boolean, level: number, reducedMotion: boolean): void;
  // Native-22 and older resolve void/null. Native-23 adds capture diagnostics;
  // audio chunks themselves remain the source of truth for the PCM format.
  startPcmCapture(): Promise<PcmCaptureInfo | null>;
  stopPcmCapture(): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

export type PcmCaptureInfo = {
  sampleRate: number;
  source: "voice_recognition" | "voice_communication" | "mic";
  noiseSuppressor: boolean;
  automaticGainControl: boolean;
};

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
  type: "connecting" | "open" | "output" | "closed" | "error";
  data?: string;
  code?: number;
  message?: string;
};

export type NativeDiscoveredPort = {
  port: number;
  name: string;
  process: string | null;
  pid: number | null;
  cwd: string | null;
  kind: "web" | "node" | "python" | "container" | "service";
};

export type NativeCommandDelivery = {
  connectionId: string;
  commandId: string;
  method: string;
  threadId: string | null;
  targetCommandId: string | null;
  text: string;
  attachments: RemoteFileAttachment[];
  state: "queued" | "sending" | "accepted" | "uncertain" | "failed" | "delivered";
  attempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

const bridge = NativeModules.CodeWideNative as NativeBridge | undefined;
const emitter = bridge === undefined ? null : new NativeEventEmitter(NativeModules.CodeWideNative);

export async function claimNativePairing(input: {
  endpoint: string;
  pairingToken: string;
  deviceName: string;
  tlsPinSha256?: string;
}): Promise<{ deviceId: string; capabilityToken: string }> {
  if (bridge === undefined || Platform.OS !== "android") throw new Error("Native secure pairing is unavailable in this build");
  return await bridge.claimPairing(input.endpoint, input.pairingToken, input.deviceName, input.tlsPinSha256 ?? null);
}

export async function saveNativeConnectionCredentials(input: {
  connectionId: string;
  endpoint: string;
  token?: string;
  tlsPinSha256?: string;
  enabled: boolean;
}): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android") throw new Error("Native credential storage is unavailable in this build");
  await bridge.saveConnectionCredentials(input.connectionId, input.endpoint, input.token ?? null, input.tlsPinSha256 ?? null, input.enabled);
}

export async function listNativeConnectionConfigs(): Promise<NativeConnectionConfig[]> {
  if (bridge === undefined || Platform.OS !== "android") return [];
  const raw = await bridge.listConnectionConfigs();
  if (!Array.isArray(raw)) throw new Error("Native connection config projection is invalid");
  return raw.map((value) => {
    if (
      value === null || typeof value !== "object"
      || typeof value.connectionId !== "string" || value.connectionId.length < 1
      || typeof value.endpoint !== "string"
      || !(value.tlsPinSha256 === null || typeof value.tlsPinSha256 === "string")
      || typeof value.enabled !== "boolean"
    ) throw new Error("Native connection config projection is invalid");
    return value;
  });
}

export async function purgeLegacyDerivedStorage(): Promise<number> {
  // An OTA may briefly run on an older native shell. Cleanup is retried on
  // every startup once a compatible APK is installed.
  if (bridge === undefined || Platform.OS !== "android" || bridge.purgeLegacyDerivedStorage === undefined) return 0;
  const reclaimedBytes = await bridge.purgeLegacyDerivedStorage();
  return Number.isFinite(reclaimedBytes) && reclaimedBytes >= 0 ? reclaimedBytes : 0;
}

export async function deleteNativeConnection(connectionId: string): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android") throw new Error("Native connection storage is unavailable");
  await bridge.deleteConnectionCredentials(connectionId);
}

export async function setNativeConnectionEnabled(connectionId: string, enabled: boolean): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android") throw new Error("Native connection lifecycle is unavailable in this build");
  await bridge.setConnectionEnabled(connectionId, enabled);
}

export async function mintNativeSession(connectionId: string): Promise<{ sessionToken: string; expiresAt: number }> {
  if (bridge === undefined || Platform.OS !== "android") throw new Error("Native session proof is unavailable in this build");
  return await bridge.mintStoredSession(connectionId);
}

/** Permanently disables the service-owned session and removes its credentials. */
export function reconnectNativeConnection(connectionId: string): void {
  if (bridge === undefined || Platform.OS !== "android") throw new Error("Native remote transport is unavailable");
  bridge.resetSocket(connectionId, "user_reconnect");
}

export function wakeNativeConnection(connectionId: string): void {
  if (bridge === undefined || Platform.OS !== "android") return;
  bridge.wakeSocket(connectionId);
}

export async function listNativePortForwards(connectionId: string): Promise<NativePortForwardProfile[]> {
  // OTA JavaScript can run briefly on an older native shell. Port forwarding
  // is ancillary to opening a conversation, so an unavailable bridge method
  // must degrade to an empty catalog instead of producing a global LogBox.
  if (bridge === undefined || Platform.OS !== "android" || typeof bridge.listPortForwards !== "function") return [];
  const value = JSON.parse(await bridge.listPortForwards(connectionId)) as unknown;
  if (!Array.isArray(value)) throw new Error("Native port-forward projection is invalid");
  return value.map(parseNativePortForwardProfile);
}

export async function discoverNativePorts(connectionId: string): Promise<{ ports: NativeDiscoveredPort[]; scannedAt: number }> {
  if (bridge === undefined || Platform.OS !== "android" || typeof bridge.discoverPorts !== "function") {
    return { ports: [], scannedAt: Date.now() };
  }
  const value = JSON.parse(await bridge.discoverPorts(connectionId)) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Native port discovery projection is invalid");
  const row = value as { ports?: unknown; scannedAt?: unknown };
  if (!Array.isArray(row.ports) || typeof row.scannedAt !== "number") throw new Error("Native port discovery projection is invalid");
  return { ports: row.ports.map(parseNativeDiscoveredPort), scannedAt: row.scannedAt };
}

export async function upsertNativePortForward(input: {
  connectionId: string;
  profileId: string;
  label: string;
  remotePort: number;
  preferredLocalPort: number | null;
}): Promise<NativePortForwardProfile> {
  if (bridge === undefined || Platform.OS !== "android") throw new Error("Native port forwarding is available on Android only");
  return parseNativePortForwardProfile(JSON.parse(await bridge.upsertPortForward(
    input.connectionId,
    input.profileId,
    input.label,
    input.remotePort,
    input.preferredLocalPort,
  )));
}

export async function startNativePortForward(profileId: string): Promise<NativePortForwardProfile> {
  if (bridge === undefined || Platform.OS !== "android") throw new Error("Native port forwarding is available on Android only");
  return parseNativePortForwardProfile(JSON.parse(await bridge.startPortForward(profileId)));
}

export async function stopNativePortForward(profileId: string): Promise<NativePortForwardProfile> {
  if (bridge === undefined || Platform.OS !== "android") throw new Error("Native port forwarding is available on Android only");
  return parseNativePortForwardProfile(JSON.parse(await bridge.stopPortForward(profileId)));
}

export async function removeNativePortForward(profileId: string): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android") throw new Error("Native port forwarding is available on Android only");
  await bridge.removePortForward(profileId);
}

export function subscribeNativePortForwards(listener: (event: NativePortForwardEvent) => void): () => void {
  if (emitter === null || Platform.OS !== "android") return () => {};
  const subscription = emitter.addListener("CodeWidePortForwardEvent", (raw: unknown) => {
    try {
      const value = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
      listener(parseNativePortForwardEvent(value));
    } catch (error) {
      console.warn("Ignored invalid native port-forward event", error);
    }
  });
  return () => subscription.remove();
}

export async function openNativeTerminal(input: {
  sessionId: string;
  connectionId: string;
  cwd: string | null;
  cols: number;
  rows: number;
}): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android" || typeof bridge.openTerminal !== "function") {
    throw new Error("This app build does not include terminal support");
  }
  await bridge.openTerminal(input.sessionId, input.connectionId, input.cwd, input.cols, input.rows);
}

export async function writeNativeTerminal(sessionId: string, base64: string): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android" || typeof bridge.writeTerminal !== "function") {
    throw new Error("This app build does not include terminal support");
  }
  await bridge.writeTerminal(sessionId, base64);
}

export async function resizeNativeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android" || typeof bridge.resizeTerminal !== "function") {
    throw new Error("This app build does not include terminal support");
  }
  await bridge.resizeTerminal(sessionId, cols, rows);
}

export function closeNativeTerminal(sessionId: string): void {
  bridge?.closeTerminal?.(sessionId);
}

export function subscribeNativeTerminal(listener: (event: NativeTerminalEvent) => void): () => void {
  if (emitter === null || Platform.OS !== "android") return () => {};
  const subscription = emitter.addListener("CodeWideTerminalEvent", (raw: unknown) => {
    try {
      const value = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
      listener(parseNativeTerminalEvent(value));
    } catch (error) {
      console.warn("Ignored invalid native terminal event", error);
    }
  });
  return () => subscription.remove();
}

function parseNativeTerminalEvent(value: unknown): NativeTerminalEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Native terminal event is invalid");
  const row = value as Partial<NativeTerminalEvent>;
  if (
    typeof row.sessionId !== "string" || row.sessionId.length === 0
    || typeof row.connectionId !== "string" || row.connectionId.length === 0
    || !["connecting", "open", "output", "closed", "error"].includes(row.type ?? "")
    || !(row.data === undefined || typeof row.data === "string")
    || !(row.code === undefined || (typeof row.code === "number" && Number.isInteger(row.code)))
    || !(row.message === undefined || typeof row.message === "string")
  ) throw new Error("Native terminal event is invalid");
  if (row.type === "output" && row.data === undefined) throw new Error("Native terminal output is missing");
  return row as NativeTerminalEvent;
}

export function parseNativePortForwardProfile(value: unknown): NativePortForwardProfile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Native port-forward projection is invalid");
  }
  const row = value as Partial<NativePortForwardProfile>;
  if (
    typeof row.id !== "string" || row.id.length === 0
    || typeof row.connectionId !== "string" || row.connectionId.length === 0
    || typeof row.label !== "string" || row.label.length === 0
    || row.remoteHost !== "127.0.0.1"
    || !isPort(row.remotePort)
    || !(row.preferredLocalPort === null || isPort(row.preferredLocalPort))
    || !(row.localPort === null || isPort(row.localPort))
    || typeof row.enabled !== "boolean"
    || !["stopped", "connecting", "live", "error"].includes(row.status ?? "")
    || !(row.previewUrl === null || typeof row.previewUrl === "string")
    || !(row.error === null || typeof row.error === "string")
    || typeof row.updatedAt !== "number"
  ) throw new Error("Native port-forward projection is invalid");
  return row as NativePortForwardProfile;
}

function parseNativePortForwardEvent(value: unknown): NativePortForwardEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Native port-forward event is invalid");
  }
  const row = value as { type?: unknown; profile?: unknown; id?: unknown };
  if (row.type === "profile") return { type: "profile", profile: parseNativePortForwardProfile(row.profile) };
  if (row.type === "removed" && typeof row.id === "string" && row.id.length > 0) return { type: "removed", id: row.id };
  throw new Error("Native port-forward event is invalid");
}

function parseNativeDiscoveredPort(value: unknown): NativeDiscoveredPort {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Native discovered port is invalid");
  const row = value as Partial<NativeDiscoveredPort>;
  if (
    !isPort(row.port)
    || typeof row.name !== "string" || row.name.length === 0
    || !(row.process === null || typeof row.process === "string")
    || !(row.pid === null || (typeof row.pid === "number" && Number.isSafeInteger(row.pid) && row.pid > 0))
    || !(row.cwd === null || typeof row.cwd === "string")
    || !["web", "node", "python", "container", "service"].includes(row.kind ?? "")
  ) throw new Error("Native discovered port is invalid");
  return row as NativeDiscoveredPort;
}

function isPort(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 65_535;
}

export async function enqueueNativeCommand(
  connectionId: string,
  commandId: string,
    method: "turn/start" | "turn/steer" | "thread/name/set" | "thread/archive" | "thread/unarchive" | "thread/delete"
      | "thread/settings/update" | "turn/interrupt" | "serverRequest/respond"
      | "companion/queue/put" | "companion/queue/edit" | "companion/queue/cancel"
      | "companion/queue/move" | "companion/queue/retry" | "companion/queue/steer",
  params: Record<string, unknown>,
): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android") throw new Error("Native durable command queue is unavailable");
  const raw = await bridge.engineEnqueueCommand(connectionId, commandId, method, JSON.stringify(params));
  const envelope = JSON.parse(raw) as { ok?: boolean; message?: string };
  if (envelope.ok !== true) throw new Error(envelope.message ?? "Could not persist native command");
}

export async function listNativeCommands(): Promise<NativeCommandDelivery[]> {
  if (bridge === undefined || Platform.OS !== "android") return [];
  const raw = await bridge.engineListCommands();
  const envelope = JSON.parse(raw) as { ok?: boolean; result?: unknown; message?: string };
  if (envelope.ok !== true || !Array.isArray(envelope.result)) {
    throw new Error(envelope.message ?? "Could not read native commands");
  }
  return envelope.result.map(parseNativeCommandDelivery);
}

export async function retryNativeCommand(connectionId: string, commandId: string): Promise<NativeCommandDelivery> {
  if (bridge === undefined || Platform.OS !== "android") throw new Error("Native durable command queue is unavailable");
  if (bridge.engineRetryCommand === undefined) throw new Error("Retry requires the latest Android app version");
  const raw = await bridge.engineRetryCommand(connectionId, commandId);
  const envelope = JSON.parse(raw) as { ok?: boolean; result?: unknown; message?: string };
  if (envelope.ok !== true) throw new Error(envelope.message ?? "Could not retry message");
  return parseNativeCommandDelivery(envelope.result);
}

/**
 * Retires the native receipt after the same prompt is present in the durable
 * authoritative projection. Older installed shells do not expose this bridge;
 * the UI projection can still reconcile it locally until the next APK update.
 */
export async function acknowledgeNativeCommandReceipt(connectionId: string, commandId: string): Promise<void> {
  if (bridge === undefined || Platform.OS !== "android" || bridge.engineAcknowledgeCommandReceipt === undefined) return;
  await bridge.engineAcknowledgeCommandReceipt(connectionId, commandId);
}

export function parseNativeCommandDelivery(value: unknown): NativeCommandDelivery {
  if (value === null || typeof value !== "object") throw new Error("Native command projection is invalid");
  const row = value as Partial<NativeCommandDelivery>;
  const attachments = Array.isArray(row.attachments) ? row.attachments.filter((attachment): attachment is RemoteFileAttachment => (
    attachment !== null
      && typeof attachment === "object"
      && typeof attachment.id === "string"
      && typeof attachment.rootId === "string"
      && typeof attachment.path === "string"
      && typeof attachment.name === "string"
      && (attachment.kind === "image" || attachment.kind === "audio" || attachment.kind === "file")
  )) : [];
  if (
    typeof row.connectionId !== "string" || typeof row.commandId !== "string" ||
    typeof row.method !== "string" || !(row.threadId === null || typeof row.threadId === "string") ||
    !(row.targetCommandId === null || typeof row.targetCommandId === "string") ||
    typeof row.text !== "string" ||
    !["queued", "sending", "accepted", "uncertain", "failed", "delivered"].includes(row.state ?? "") ||
    typeof row.attempts !== "number" || typeof row.createdAt !== "number" || typeof row.updatedAt !== "number" ||
    !(row.lastError === null || typeof row.lastError === "string")
  ) throw new Error("Native command projection is invalid");
  return { ...(row as NativeCommandDelivery), attachments };
}

export async function startVoiceRecognition(
  onEvent: (event: NativeVoiceEvent) => void,
  localeTag: string | null = null,
): Promise<() => void> {
  if (bridge === undefined || emitter === null || Platform.OS !== "android") throw new Error("Native voice input is unavailable");
  const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error("Microphone permission was denied");
  let armed = false;
  let stopped = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const pendingEvents: NativeVoiceEvent[] = [];
  const cleanup = (stopNative: boolean) => {
    if (stopped) return;
    stopped = true;
    if (watchdog !== undefined) clearTimeout(watchdog);
    watchdog = undefined;
    if (stopNative) bridge.stopVoiceInput();
    subscription.remove();
  };
  const deliver = (event: NativeVoiceEvent) => {
    if (stopped) return;
    onEvent(event);
    if (event.type === "final" || event.type === "error") cleanup(true);
  };
  const subscription = emitter.addListener("CodeWideVoiceEvent", (event: NativeVoiceEvent) => {
    if (!armed) pendingEvents.push(event);
    else deliver(event);
  });
  try {
    await bridge.startVoiceInput(localeTag);
  } catch (error) {
    cleanup(false);
    throw error;
  }
  watchdog = setTimeout(() => deliver({ type: "error", text: "timeout" }), 30_000);
  setTimeout(() => {
    if (stopped) return;
    armed = true;
    for (const event of pendingEvents.splice(0)) deliver(event);
  }, 0);
  return () => cleanup(true);
}

export function cancelVoiceRecognition(): void {
  bridge?.stopVoiceInput();
}

export function setNativeVoiceAuraState(active: boolean, level: number, reducedMotion: boolean): void {
  if (bridge === undefined || Platform.OS !== "android" || bridge.setVoiceAuraState === undefined) return;
  bridge.setVoiceAuraState(active, Math.max(0, Math.min(1, level)), reducedMotion);
}

export async function startPcmCapture(
  onChunk: (chunk: PcmAudioChunk) => void,
  onError: (message: string) => void,
): Promise<{ stop(): void; info: PcmCaptureInfo | null }> {
  if (bridge === undefined || emitter === null || Platform.OS !== "android") throw new Error("Native audio capture is unavailable");
  const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error("Microphone permission was denied");
  let stopped = false;
  const subscription = emitter.addListener("CodeWideAudioEvent", (event: NativeAudioEvent) => {
    if (stopped) return;
    if (event.type === "chunk") onChunk(event);
    else if (event.type === "error") onError(event.error ?? "audio_capture_failed");
  });
  try {
    const capture = await bridge.startPcmCapture();
    const info = isPcmCaptureInfo(capture) ? capture : null;
    if (info !== null) {
      console.info(
        `CodeWide microphone: ${info.sampleRate} Hz, ${info.source}, ` +
        `noiseSuppressor=${info.noiseSuppressor}, automaticGainControl=${info.automaticGainControl}`,
      );
    } else {
      console.info("CodeWide microphone started with a legacy native capture bridge");
    }
    return {
      info,
      stop: () => {
        if (stopped) return;
        stopped = true;
        subscription.remove();
        bridge.stopPcmCapture();
      },
    };
  } catch (cause) {
    stopped = true;
    subscription.remove();
    throw cause;
  }
}

function isPcmCaptureInfo(value: unknown): value is PcmCaptureInfo {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const info = value as Partial<PcmCaptureInfo>;
  return Number.isSafeInteger(info.sampleRate)
    && (info.sampleRate ?? 0) >= 8_000
    && (info.sampleRate ?? 0) <= 96_000
    && (info.source === "voice_recognition" || info.source === "voice_communication" || info.source === "mic")
    && typeof info.noiseSuppressor === "boolean"
    && typeof info.automaticGainControl === "boolean";
}

export function stopPcmCapture(): void {
  bridge?.stopPcmCapture();
}
