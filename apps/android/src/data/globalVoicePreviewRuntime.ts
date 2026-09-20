import { RpcResponseError } from "@codewide/sync-client";

import type { NativeLiveRealtimeEvent } from "../native/native-engine-contract";
import type {
  GlobalSupervisorWebRtcSession,
  GlobalSupervisorWebRtcSessionFactory,
} from "../native/globalSupervisorWebRtcSessionContract";
import {
  globalSupervisorQualifiedChatRef,
  type GlobalSupervisorBindingOwner,
  type GlobalSupervisorQualifiedChatRef,
} from "./globalSupervisorBinding";
import { globalSupervisorLimitsV1 } from "./globalSupervisorLimitsV1";
import type { GlobalSupervisorRuntimeIngress } from "./globalSupervisorRuntimeIngress";
import type { GlobalVoiceName } from "./globalVoicePreferences";
import { unknownRecord } from "./unknownRecord";
import type { V1MicrophoneLease, V1MicrophoneLeaseRegistry } from "./v1MicrophoneLease";
import type { WorkspaceSyncSession, WorkspaceSyncSupervisor } from "./workspace-session";

const GLOBAL_SUPERVISOR_THREAD_UNAVAILABLE_RPC_CODE = -32_061;
const MAX_SUPPORTED_VOICES = 64;
const MAX_VOICE_NAME_CHARACTERS = 32;
const PREVIEW_AUDIO_QUIET_MS = 700;
const PREVIEW_AUDIO_TIMEOUT_MS = 15_000;
const PREVIEW_TEXT = "Привет! Я твой голосовой ассистент CodeWide.";

type GlobalVoicePreviewAuthority = {
  readonly binding: () => GlobalSupervisorBindingOwner;
  readonly enabledConnectionIds: () => readonly string[];
  readonly ensureStarted: () => Promise<void>;
  readonly getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  readonly getSupervisor: () => WorkspaceSyncSupervisor | null;
  readonly ingress: GlobalSupervisorRuntimeIngress;
  readonly isRpcAvailable: (connectionId: string) => boolean;
  readonly microphoneLeases: V1MicrophoneLeaseRegistry;
  readonly randomUUID: () => string;
  readonly rpcAfterAttach: <Result>(
    session: WorkspaceSyncSession,
    method: string,
    params: unknown,
  ) => Promise<Result>;
  readonly startWebRtc: GlobalSupervisorWebRtcSessionFactory;
};

/** Short, isolated playback capability used by the app settings surface. */
export type GlobalVoicePreviewRuntime = {
  readonly play: (voice: GlobalVoiceName) => Promise<void>;
};

type PreviewState = {
  acknowledged: boolean;
  channelTerminal: boolean;
  closed: boolean;
  nextSequence: number;
  quietTimer: ReturnType<typeof setTimeout> | null;
  realtimeSdpReceived: boolean;
  realtimeStarted: boolean;
  realtimeStartRequested: boolean;
  speechCompleted: boolean;
  subscribed: boolean;
};

type PreviewResources = {
  readonly channelId: string;
  readonly complete: PromiseWithResolvers<undefined>;
  readonly home: GlobalSupervisorQualifiedChatRef;
  readonly lease: V1MicrophoneLease;
  readonly session: WorkspaceSyncSession;
  readonly startup: PromiseWithResolvers<undefined>;
  readonly state: PreviewState;
  readonly subscription: ReturnType<GlobalSupervisorRuntimeIngress["subscribeLive"]>;
  readonly supervisor: WorkspaceSyncSupervisor;
  readonly webRtc: GlobalSupervisorWebRtcSession;
};

function liveSession(
  authority: GlobalVoicePreviewAuthority,
  connectionId: string,
): WorkspaceSyncSession {
  const session = authority.getSession(connectionId);
  if (session === undefined || !authority.isRpcAvailable(connectionId)) {
    throw new Error("Global Voice preview server is unavailable");
  }
  return session;
}

function validVoice(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_VOICE_NAME_CHARACTERS;
}

function assertVoiceAvailable(value: unknown, voice: GlobalVoiceName): void {
  const response = unknownRecord(value);
  const voices = unknownRecord(response?.voices);
  const supported = voices?.v1;
  if (
    !Array.isArray(supported) ||
    supported.length === 0 ||
    supported.length > MAX_SUPPORTED_VOICES ||
    !supported.every(validVoice) ||
    !supported.includes(voice)
  ) {
    throw new Error("The selected Global Voice is unavailable");
  }
}

async function withTimeout<Result>(operation: Promise<Result>, timeoutMs: number): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Global Voice preview timed out"));
    }, timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("Global Voice preview failed"));
      },
    );
  });
}

function readyHome(
  binding: Awaited<ReturnType<GlobalSupervisorBindingOwner["read"]>>,
): GlobalSupervisorQualifiedChatRef | null {
  return binding?.status === "ready" ? binding.home : null;
}

async function reconcileCreatingHome(
  owner: GlobalSupervisorBindingOwner,
  current: Awaited<ReturnType<GlobalSupervisorBindingOwner["read"]>>,
): Promise<GlobalSupervisorQualifiedChatRef | null> {
  if (current?.status === "creating") {
    return readyHome(await owner.reconcile());
  }
  return null;
}

async function createPreviewHome(
  authority: GlobalVoicePreviewAuthority,
  owner: GlobalSupervisorBindingOwner,
  current: Awaited<ReturnType<GlobalSupervisorBindingOwner["read"]>>,
): Promise<GlobalSupervisorQualifiedChatRef> {
  const connectionId = authority.enabledConnectionIds()[0];
  if (connectionId === undefined) {
    throw new Error("No Global Voice preview server is available");
  }
  if (current !== null) {
    await owner.reset();
  }
  return owner.bind(connectionId);
}

async function previewHome(
  authority: GlobalVoicePreviewAuthority,
): Promise<GlobalSupervisorQualifiedChatRef> {
  await authority.ensureStarted();
  const owner = authority.binding();
  const current = await owner.read();
  const ready = readyHome(current);
  if (ready !== null) {
    return ready;
  }
  const reconciled = await reconcileCreatingHome(owner, current);
  return reconciled ?? createPreviewHome(authority, owner, current);
}

type PreviewEventOptions = {
  readonly channelId: string;
  readonly complete: PromiseWithResolvers<undefined>;
  readonly startup: PromiseWithResolvers<undefined>;
  readonly state: PreviewState;
  readonly threadId: string;
  readonly webRtc: GlobalSupervisorWebRtcSession;
};

function previewError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function rejectPreview(options: PreviewEventOptions, error: Error): void {
  options.startup.reject(error);
  options.complete.reject(error);
}

function acceptPreviewSubscription(
  options: PreviewEventOptions,
  event: Extract<NativeLiveRealtimeEvent, { readonly event: "subscribed" }>,
): void {
  if (options.state.acknowledged || event.threadId !== options.threadId) {
    options.startup.reject(new Error("Global Voice preview subscription is ambiguous"));
    return;
  }
  options.state.acknowledged = true;
}

function acceptPreviewTerminal(options: PreviewEventOptions): void {
  options.state.channelTerminal = true;
  rejectPreview(options, new Error("Global Voice preview channel closed"));
}

function validPreviewEnvelope(
  options: PreviewEventOptions,
  event: Extract<NativeLiveRealtimeEvent, { readonly event: "payload" }>,
): boolean {
  return (
    options.state.acknowledged &&
    event.threadId === options.threadId &&
    event.sequence === options.state.nextSequence
  );
}

function acceptPreviewStarted(
  options: PreviewEventOptions,
  params: Readonly<Record<string, unknown>> | null,
): void {
  const valid =
    !options.state.realtimeStarted &&
    params?.threadId === options.threadId &&
    params.version === "v3";
  if (!valid) {
    options.startup.reject(new Error("Global Voice preview startup is ambiguous"));
    return;
  }
  options.state.realtimeStarted = true;
}

function finishPreviewAfterQuiet(options: PreviewEventOptions): void {
  options.complete.resolve(undefined);
}

function acceptPreviewTranscript(
  options: PreviewEventOptions,
  params: Readonly<Record<string, unknown>>,
): void {
  if (params.role !== "assistant" || typeof params.text !== "string" || params.text.length === 0) {
    return;
  }
  options.state.speechCompleted = true;
  if (options.state.quietTimer !== null) {
    clearTimeout(options.state.quietTimer);
  }
  options.state.quietTimer = setTimeout(() => {
    finishPreviewAfterQuiet(options);
  }, PREVIEW_AUDIO_QUIET_MS);
}

function acceptPreviewSdp(
  options: PreviewEventOptions,
  params: Readonly<Record<string, unknown>>,
  webRtc: GlobalSupervisorWebRtcSession,
): void {
  const sdp = params.sdp;
  if (
    !options.state.realtimeStarted ||
    options.state.realtimeSdpReceived ||
    typeof sdp !== "string"
  ) {
    rejectPreview(options, new Error("Global Voice preview WebRTC answer is ambiguous"));
    return;
  }
  options.state.realtimeSdpReceived = true;
  void webRtc.acceptAnswer(sdp).then(
    () => {
      options.startup.resolve(undefined);
    },
    (error: unknown) => {
      rejectPreview(options, previewError(error, "Global Voice preview WebRTC negotiation failed"));
    },
  );
}

function acceptActivePreviewPayload(
  options: PreviewEventOptions,
  method: unknown,
  params: Readonly<Record<string, unknown>>,
): void {
  switch (method) {
    case "thread/realtime/outputAudio/delta":
      rejectPreview(options, new Error("Global Voice preview received WebSocket audio"));
      return;
    case "thread/realtime/transcript/done":
      acceptPreviewTranscript(options, params);
      return;
    case "thread/realtime/error":
      rejectPreview(
        options,
        new Error(
          typeof params.message === "string"
            ? params.message
            : "Global Voice preview realtime session failed",
        ),
      );
      return;
    case "thread/realtime/closed":
      options.state.closed = true;
      rejectPreview(options, new Error("Global Voice preview realtime session closed"));
  }
}

function acceptPreviewPayload(
  options: PreviewEventOptions,
  event: Extract<NativeLiveRealtimeEvent, { readonly event: "payload" }>,
): void {
  if (!validPreviewEnvelope(options, event)) {
    rejectPreview(options, new Error("Global Voice preview event sequence is invalid"));
    return;
  }
  options.state.nextSequence += 1;
  const method = event.payload.method;
  const params = unknownRecord(event.payload.params);
  if (method === "thread/realtime/started") {
    acceptPreviewStarted(options, params);
    return;
  }
  acceptPreviewStartedSessionPayload(options, method, params);
}

function acceptPreviewStartedSessionPayload(
  options: PreviewEventOptions,
  method: unknown,
  params: Readonly<Record<string, unknown>> | null,
): void {
  if (params?.threadId !== options.threadId) {
    options.complete.reject(new Error("Global Voice preview payload is invalid"));
    return;
  }
  if (method === "thread/realtime/error" || method === "thread/realtime/closed") {
    acceptActivePreviewPayload(options, method, params);
    return;
  }
  if (!options.state.realtimeStarted) {
    options.complete.reject(new Error("Global Voice preview payload is invalid"));
    return;
  }
  if (method === "thread/realtime/sdp") {
    acceptPreviewSdp(options, params, options.webRtc);
    return;
  }
  acceptActivePreviewPayload(options, method, params);
}

function acceptPreviewEvent(options: PreviewEventOptions, event: NativeLiveRealtimeEvent): void {
  if (event.channelId !== options.channelId) {
    return;
  }
  switch (event.event) {
    case "subscribed":
      acceptPreviewSubscription(options, event);
      return;
    case "terminal":
      acceptPreviewTerminal(options);
      return;
    case "payload":
      acceptPreviewPayload(options, event);
  }
}

function createPreviewState(): PreviewState {
  return {
    acknowledged: false,
    channelTerminal: false,
    closed: false,
    nextSequence: 1,
    quietTimer: null,
    realtimeSdpReceived: false,
    realtimeStarted: false,
    realtimeStartRequested: false,
    speechCompleted: false,
    subscribed: false,
  };
}

function createPreviewResources(options: {
  readonly authority: GlobalVoicePreviewAuthority;
  readonly home: GlobalSupervisorQualifiedChatRef;
  readonly lease: V1MicrophoneLease;
  readonly session: WorkspaceSyncSession;
  readonly supervisor: WorkspaceSyncSupervisor;
  readonly webRtc: GlobalSupervisorWebRtcSession;
}): PreviewResources {
  const { authority, home, lease, session, supervisor, webRtc } = options;
  const channelId = authority.randomUUID();
  const complete = Promise.withResolvers<undefined>();
  const startup = Promise.withResolvers<undefined>();
  // Realtime can fail synchronously inside the start RPC before runPreviewSession awaits either
  // phase. Observe both deferred promises immediately while preserving their rejected state.
  void complete.promise.catch(() => undefined);
  void startup.promise.catch(() => undefined);
  const state = createPreviewState();
  const eventOptions: PreviewEventOptions = {
    channelId,
    complete,
    startup,
    state,
    threadId: home.threadId,
    webRtc,
  };
  const subscription = authority.ingress.subscribeLive((connectionId, event) => {
    if (connectionId === home.connectionId) {
      acceptPreviewEvent(eventOptions, event);
    }
  });
  return {
    channelId,
    complete,
    home,
    lease,
    session,
    startup,
    state,
    subscription,
    supervisor,
    webRtc,
  };
}

async function runPreviewSession(
  authority: GlobalVoicePreviewAuthority,
  resources: PreviewResources,
  voice: GlobalVoiceName,
): Promise<void> {
  const { channelId, complete, home, session, startup, state, supervisor, webRtc } = resources;
  await supervisor.subscribeLive(home.connectionId, channelId, home.threadId);
  state.subscribed = true;
  state.realtimeStartRequested = true;
  await authority.rpcAfterAttach(session, "thread/realtime/start", {
    clientManagedHandoffs: true,
    includeStartupContext: false,
    initialItems: [],
    outputModality: "audio",
    threadId: home.threadId,
    transport: { sdp: webRtc.offerSdp, type: "webrtc" },
    version: "v3",
    voice,
  });
  await withTimeout(startup.promise, globalSupervisorLimitsV1.realtimeStartupTimeoutMs);
  await authority.rpcAfterAttach(session, "thread/realtime/appendSpeech", {
    text: PREVIEW_TEXT,
    threadId: home.threadId,
  });
  await withTimeout(complete.promise, PREVIEW_AUDIO_TIMEOUT_MS);
  if (!state.speechCompleted) {
    throw new Error("Global Voice preview returned no speech completion");
  }
}

async function cleanupPreviewSession(
  authority: GlobalVoicePreviewAuthority,
  resources: PreviewResources,
): Promise<Error | null> {
  const { channelId, home, session, state, subscription, supervisor, webRtc } = resources;
  if (state.quietTimer !== null) {
    clearTimeout(state.quietTimer);
  }
  const failures: unknown[] = [];
  if (state.realtimeStartRequested && !state.closed) {
    await authority
      .rpcAfterAttach(session, "thread/realtime/stop", { threadId: home.threadId })
      .catch((error: unknown) => {
        failures.push(error);
      });
  }
  if (state.subscribed && !state.channelTerminal) {
    await supervisor.unsubscribeLive(home.connectionId, channelId).catch((error: unknown) => {
      failures.push(error);
    });
  }
  subscription.unsubscribe();
  await webRtc.stop().catch((error: unknown) => {
    failures.push(error);
  });
  await resources.lease.release();
  return failures.length === 0 ? null : new Error("Global Voice preview cleanup failed");
}

async function playOnce(
  authority: GlobalVoicePreviewAuthority,
  home: GlobalSupervisorQualifiedChatRef,
  voice: GlobalVoiceName,
): Promise<void> {
  const session = liveSession(authority, home.connectionId);
  const supervisor = authority.getSupervisor();
  if (supervisor === null) {
    throw new Error("Global Voice preview transport is unavailable");
  }
  assertVoiceAvailable(
    await authority.rpcAfterAttach<unknown>(session, "thread/realtime/listVoices", {}),
    voice,
  );
  const previewId = authority.randomUUID();
  const acquisition = authority.microphoneLeases.acquireGlobalSupervisor(previewId);
  if (acquisition.status === "busy") {
    throw new Error("Audio is already in use");
  }
  let resources: PreviewResources | null = null;
  const mediaLifecycle = { terminatedBeforeResources: false };
  let webRtc: GlobalSupervisorWebRtcSession;
  try {
    webRtc = await authority.startWebRtc({
      mode: "preview",
      onTerminal() {
        if (resources === null) {
          mediaLifecycle.terminatedBeforeResources = true;
          return;
        }
        const error = new Error("Global Voice preview WebRTC media terminated");
        resources.startup.reject(error);
        resources.complete.reject(error);
      },
    });
  } catch (error) {
    await acquisition.lease.release();
    throw error;
  }
  resources = createPreviewResources({
    authority,
    home,
    lease: acquisition.lease,
    session,
    supervisor,
    webRtc,
  });
  if (mediaLifecycle.terminatedBeforeResources) {
    await webRtc.stop().catch(() => undefined);
    await acquisition.lease.release();
    throw new Error("Global Voice preview WebRTC media terminated during startup");
  }
  let primaryFailure: Error | null = null;
  try {
    await runPreviewSession(authority, resources, voice);
  } catch (error) {
    primaryFailure = previewError(error, "Global Voice preview failed");
  }
  const cleanupFailure = await cleanupPreviewSession(authority, resources);
  if (primaryFailure !== null) {
    throw primaryFailure;
  }
  if (cleanupFailure !== null) {
    throw cleanupFailure;
  }
}

/** Plays the selected GPT Live voice without opening capture or agent context. */
export function createGlobalVoicePreviewRuntime(
  authority: GlobalVoicePreviewAuthority,
): GlobalVoicePreviewRuntime {
  return {
    async play(voice) {
      const home = await previewHome(authority);
      try {
        await playOnce(authority, home, voice);
        return;
      } catch (error) {
        if (
          !(error instanceof RpcResponseError) ||
          error.code !== GLOBAL_SUPERVISOR_THREAD_UNAVAILABLE_RPC_CODE
        ) {
          throw error;
        }
      }
      const binding = authority.binding();
      await binding.reset();
      const replacement = await binding.bind(home.connectionId);
      await playOnce(
        authority,
        globalSupervisorQualifiedChatRef(replacement.connectionId, replacement.threadId),
        voice,
      );
    },
  };
}
