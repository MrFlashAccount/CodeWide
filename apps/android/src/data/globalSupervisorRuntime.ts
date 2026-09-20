import { RpcResponseError } from "@codewide/sync-client";

import type { NativeLiveRealtimeEvent } from "../native/native-engine-contract";
import type { MicrophonePermission } from "../native/native-transport";
import type {
  GlobalSupervisorWebRtcSession,
  GlobalSupervisorWebRtcSessionFactory,
} from "../native/globalSupervisorWebRtcSessionContract";
import {
  globalSupervisorQualifiedChatRef,
  type GlobalSupervisorBindingOwner,
  type GlobalSupervisorQualifiedChatRef,
} from "./globalSupervisorBinding";
import {
  createGlobalSupervisorAttentionDeliverySession,
  type GlobalSupervisorAttentionDeliverySession,
} from "./globalSupervisorAttentionDelivery";
import type { GlobalSupervisorAttentionOwner } from "./globalSupervisorAttention";
import { createGlobalSupervisorEventSignalSession } from "./globalSupervisorEventSignals";
import { globalSupervisorLimitsV1 } from "./globalSupervisorLimitsV1";
import { createGlobalSupervisorMediaOwner } from "./globalSupervisorMediaOwner";
import {
  createGlobalSupervisorReconnectOwner,
  GLOBAL_SUPERVISOR_RECONNECT_POLICY,
  type GlobalSupervisorReconnectController,
  type GlobalSupervisorReconnectPolicy,
} from "./globalSupervisorReconnectOwner";
import type { GlobalVoiceName } from "./globalVoicePreferences";
import type { GlobalSupervisorRuntimeIngress } from "./globalSupervisorRuntimeIngress";
import { globalSupervisorRealtimeStartInstructions } from "./globalSupervisorThreadProfile";
import { unknownRecord } from "./unknownRecord";
import type { VoiceAssistantPersonality } from "./voiceAssistantPersonality";
import type { V1MicrophoneLeaseRegistry } from "./v1MicrophoneLease";
import type { WorkspaceSyncSession, WorkspaceSyncSupervisor } from "./workspace-session";

export type GlobalSupervisorRuntimeFailureKind =
  | "bindingUnavailable"
  | "capabilityUnavailable"
  | "homeUnavailable"
  | "microphoneBusy"
  | "microphonePermissionDenied"
  | "realtimeFailed"
  | "sessionAmbiguous";

export type GlobalSupervisorRuntimeRecoveryAction =
  | "chooseHome"
  | "reconnectHome"
  | "retryCapabilityProbe"
  | "retryMicrophoneBusy"
  | "reconcileBinding"
  | "recreateBinding";

/** Fixed, content-free startup rejection that preserves an actionable failure class. */
export class GlobalSupervisorLowerRuntimeStartError extends Error {
  readonly failure: GlobalSupervisorRuntimeFailureKind;
  readonly recovery: GlobalSupervisorRuntimeRecoveryAction;

  constructor(
    failure: GlobalSupervisorRuntimeFailureKind,
    recovery: GlobalSupervisorRuntimeRecoveryAction,
  ) {
    super("Global Voice runtime could not start");
    this.name = "GlobalSupervisorLowerRuntimeStartError";
    this.failure = failure;
    this.recovery = recovery;
  }
}

type GlobalSupervisorLowerRuntimeEvent = { readonly activationId: string } & (
  | { readonly event: "listening" | "reconnecting" | "speaking" | "thinking" }
  | {
      readonly event: "transcript";
      readonly item: {
        readonly id: string;
        readonly role: "supervisor" | "user";
        readonly text: string;
      };
    }
  | {
      readonly event: "failed";
      readonly failure: GlobalSupervisorRuntimeFailureKind;
      readonly recovery: GlobalSupervisorRuntimeRecoveryAction;
    }
);

export type GlobalSupervisorLowerRuntime = {
  readonly isActive: () => boolean;
  readonly prepare: (publish: (homeConnectionId: string) => void) => Promise<
    | { readonly home: GlobalSupervisorQualifiedChatRef; readonly status: "ready" }
    | { readonly recovery: GlobalSupervisorRuntimeRecoveryAction; readonly status: "unbound" }
    | {
        readonly failure: GlobalSupervisorRuntimeFailureKind;
        readonly recovery: GlobalSupervisorRuntimeRecoveryAction;
        readonly status: "failed";
      }
  >;
  readonly recover: (action: GlobalSupervisorRuntimeRecoveryAction) => Promise<void>;
  readonly start: (
    home: GlobalSupervisorQualifiedChatRef,
    publish: (event: GlobalSupervisorLowerRuntimeEvent) => void,
  ) => Promise<{
    readonly activationId: string;
    readonly home: GlobalSupervisorQualifiedChatRef;
    readonly pause: () => Promise<void>;
    readonly resume: () => Promise<void>;
    readonly stop: () => Promise<void>;
  }>;
};

async function settledReconnectOperation(): Promise<void> {
  await Promise.resolve();
}

type GlobalSupervisorRuntimeAuthority = {
  readonly acquireForegroundLease: () => Promise<{
    readonly release: () => Promise<void>;
    readonly setLevel: (level: number) => void;
  }>;
  readonly attention: GlobalSupervisorAttentionOwner;
  readonly binding: () => GlobalSupervisorBindingOwner;
  readonly enabledConnectionIds: () => readonly string[];
  readonly ensureStarted: () => Promise<void>;
  readonly getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  readonly getSupervisor: () => WorkspaceSyncSupervisor | null;
  readonly ingress: GlobalSupervisorRuntimeIngress;
  readonly isRpcAvailable: (connectionId: string) => boolean;
  readonly microphoneLeases: V1MicrophoneLeaseRegistry;
  readonly now: () => number;
  readonly personality: () => Promise<VoiceAssistantPersonality>;
  readonly preferredVoice: () => Promise<GlobalVoiceName>;
  readonly randomUUID: () => string;
  readonly reconnectPolicy?: GlobalSupervisorReconnectPolicy;
  readonly recordStartupStage: (event: GlobalSupervisorStartupStageEvent) => void;
  readonly requestMicrophonePermission: () => Promise<MicrophonePermission>;
  readonly rpcAfterAttach: <Result>(
    session: WorkspaceSyncSession,
    method: string,
    params: unknown,
  ) => Promise<Result>;
  readonly startWebRtc: GlobalSupervisorWebRtcSessionFactory;
};

type GlobalSupervisorStartupStage =
  | "activationCreated"
  | "offerReady"
  | "peerConnected"
  | "realtimeStarted"
  | "sdpReceived"
  | "startAccepted"
  | "subscriptionReady";

type GlobalSupervisorStartupStageEvent = {
  readonly activationId: string;
  readonly connectionId: string;
  readonly stage: GlobalSupervisorStartupStage;
  readonly threadId: string;
};

type LiveSessionState = {
  readonly activationId: string;
  attentionDelivery: GlobalSupervisorAttentionDeliverySession | null;
  readonly channelId: string;
  channelTerminal: boolean;
  readonly closedWaiters: Set<() => void>;
  failurePublished: boolean;
  nextSequence: number;
  readonly onFailure: (failure: GlobalSupervisorRuntimeFailureKind) => void;
  readonly publish: (event: GlobalSupervisorLowerRuntimeEvent) => void;
  realtimeClosed: boolean;
  realtimeSdpReceived: boolean;
  realtimeStarted: boolean;
  realtimeStartRequested: boolean;
  stopping: boolean;
  transcriptSequence: number;
  readonly webRtc: GlobalSupervisorWebRtcSession;
};

const MAX_VOICE_NAME_CHARACTERS = 32;
const MAX_SUPPORTED_VOICES = 64;
const GLOBAL_SUPERVISOR_THREAD_UNAVAILABLE_RPC_CODE = -32_061;

function liveSessionOrNull(
  authority: GlobalSupervisorRuntimeAuthority,
  connectionId: string,
): WorkspaceSyncSession | null {
  const session = authority.getSession(connectionId);
  if (session === undefined || !authority.isRpcAvailable(connectionId)) {
    return null;
  }
  return session;
}

function requireLiveSession(
  authority: GlobalSupervisorRuntimeAuthority,
  connectionId: string,
): WorkspaceSyncSession {
  const session = liveSessionOrNull(authority, connectionId);
  if (session === null) {
    throw new GlobalSupervisorLowerRuntimeStartError("homeUnavailable", "reconnectHome");
  }
  return session;
}

async function prepareReadyHome(
  authority: GlobalSupervisorRuntimeAuthority,
  home: GlobalSupervisorQualifiedChatRef,
): Promise<
  | { readonly home: GlobalSupervisorQualifiedChatRef; readonly status: "ready" }
  | {
      readonly failure: "homeUnavailable";
      readonly recovery: "reconnectHome";
      readonly status: "failed";
    }
> {
  const session = liveSessionOrNull(authority, home.connectionId);
  if (session === null) {
    return {
      failure: "homeUnavailable",
      recovery: "reconnectHome",
      status: "failed",
    };
  }
  parseRealtimeV3Voice(
    await authority.rpcAfterAttach<unknown>(session, "thread/realtime/listVoices", {}),
    await authority.preferredVoice(),
  );
  return { home, status: "ready" };
}

async function withTimeout<Result>(operation: Promise<Result>, timeoutMs: number): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Global Voice realtime startup timed out"));
    }, timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("Global Voice operation failed"));
      },
    );
  });
}

function validVoice(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_VOICE_NAME_CHARACTERS;
}

function validVoiceList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_SUPPORTED_VOICES &&
    value.every(validVoice)
  );
}

function parseRealtimeV3Voice(value: unknown, preferred: GlobalVoiceName): string {
  const response = unknownRecord(value);
  const voices = unknownRecord(response?.voices);
  // Codex Realtime V3 uses the GPT Live voice family exposed by listVoices as V1.
  const selected = voices?.defaultV1;
  const supported = voices?.v1;
  if (!validVoice(selected) || !validVoiceList(supported) || !supported.includes(selected)) {
    throw new Error("The Global Voice server returned no compatible voice");
  }
  return supported.includes(preferred) ? preferred : selected;
}

function failLiveState(state: LiveSessionState, failure: GlobalSupervisorRuntimeFailureKind): void {
  if (state.stopping || state.failurePublished) {
    return;
  }
  state.failurePublished = true;
  state.onFailure(failure);
}

function closeRealtime(state: LiveSessionState): void {
  state.realtimeClosed = true;
  for (const resolve of state.closedWaiters) {
    resolve();
  }
  state.closedWaiters.clear();
  if (!state.stopping) {
    failLiveState(state, "realtimeFailed");
  }
}

function acceptStarted(
  context: LiveEventContext,
  params: Readonly<Record<string, unknown>> | null,
): void {
  const { home, state } = context;
  if (
    !state.realtimeStartRequested ||
    state.realtimeStarted ||
    params?.threadId !== home.threadId ||
    params.version !== "v3"
  ) {
    failLiveState(state, "sessionAmbiguous");
    return;
  }
  state.realtimeStarted = true;
  context.recordStartupStage("realtimeStarted");
}

function acceptTranscript(
  state: LiveSessionState,
  params: Readonly<Record<string, unknown>>,
): void {
  const text = params.text;
  const role = params.role;
  if (typeof text !== "string" || (role !== "user" && role !== "assistant")) {
    failLiveState(state, "realtimeFailed");
    return;
  }
  state.transcriptSequence += 1;
  state.publish({
    activationId: state.activationId,
    event: "transcript",
    item: {
      id: `${state.activationId}-${String(state.transcriptSequence)}`,
      role: role === "user" ? "user" : "supervisor",
      text,
    },
  });
  state.attentionDelivery?.setSpeechBusy(role !== "assistant");
  state.publish({ activationId: state.activationId, event: "listening" });
}

function acceptActivePayload(
  state: LiveSessionState,
  method: unknown,
  params: Readonly<Record<string, unknown>>,
): void {
  switch (method) {
    case "thread/realtime/outputAudio/delta":
      // GPT Live WebRTC carries generated speech on the negotiated media track.
      failLiveState(state, "sessionAmbiguous");
      return;
    case "thread/realtime/transcript/done":
      acceptTranscript(state, params);
      return;
    case "thread/realtime/itemAdded":
      state.attentionDelivery?.setSpeechBusy(true);
      state.publish({ activationId: state.activationId, event: "thinking" });
      return;
    case "thread/realtime/error":
    case "thread/realtime/closed":
      closeRealtime(state);
  }
}

type StartupControl = {
  acknowledged: boolean;
  reject: (error: Error) => void;
  resolve: () => void;
  settled: boolean;
};

type LiveEventContext = {
  readonly control: StartupControl;
  readonly home: GlobalSupervisorQualifiedChatRef;
  readonly recordStartupStage: (stage: GlobalSupervisorStartupStage) => void;
  readonly state: LiveSessionState;
};

function acceptSdp(
  context: LiveEventContext,
  params: Readonly<Record<string, unknown>> | null,
): void {
  const { control, home, state } = context;
  const sdp = params?.sdp;
  if (
    !state.realtimeStarted ||
    state.realtimeSdpReceived ||
    params?.threadId !== home.threadId ||
    typeof sdp !== "string"
  ) {
    const error = new Error("The Global Voice WebRTC answer is ambiguous");
    control.reject(error);
    failLiveState(state, "sessionAmbiguous");
    return;
  }
  state.realtimeSdpReceived = true;
  context.recordStartupStage("sdpReceived");
  void state.webRtc.acceptAnswer(sdp).then(
    () => {
      if (state.failurePublished || state.realtimeClosed) {
        control.reject(new Error("The realtime session failed during WebRTC startup"));
        return;
      }
      context.recordStartupStage("peerConnected");
      state.publish({ activationId: state.activationId, event: "listening" });
      control.resolve();
    },
    (error: unknown) => {
      control.reject(
        error instanceof Error ? error : new Error("Global Voice WebRTC negotiation failed"),
      );
      failLiveState(state, "realtimeFailed");
    },
  );
}

function acceptEstablishedPayload(
  context: LiveEventContext,
  method: unknown,
  params: Readonly<Record<string, unknown>> | null,
): void {
  const { control, home, state } = context;
  if (!state.realtimeStarted || params?.threadId !== home.threadId) {
    failLiveState(state, "sessionAmbiguous");
    return;
  }
  acceptActivePayload(state, method, params);
  if (state.failurePublished && !control.settled) {
    control.reject(new Error("The realtime session failed during WebRTC startup"));
  }
}

function acceptPayloadMethod(
  context: LiveEventContext,
  method: unknown,
  params: Readonly<Record<string, unknown>> | null,
): void {
  if (method === "thread/realtime/started") {
    acceptStarted(context, params);
    return;
  }
  if (method === "thread/realtime/sdp") {
    acceptSdp(context, params);
    return;
  }
  acceptEstablishedPayload(context, method, params);
}

function acceptPayload(
  context: LiveEventContext,
  event: Extract<NativeLiveRealtimeEvent, { readonly event: "payload" }>,
): void {
  const { home, state } = context;
  if (
    event.channelId !== state.channelId ||
    event.threadId !== home.threadId ||
    event.sequence !== state.nextSequence
  ) {
    failLiveState(state, "sessionAmbiguous");
    return;
  }
  state.nextSequence += 1;
  const method = event.payload.method;
  const params = unknownRecord(event.payload.params);
  acceptPayloadMethod(context, method, params);
}

function acceptSubscription(
  control: StartupControl,
  event: Extract<NativeLiveRealtimeEvent, { readonly event: "subscribed" }>,
  home: GlobalSupervisorQualifiedChatRef,
): void {
  if (event.threadId !== home.threadId || control.acknowledged) {
    control.reject(new Error("The realtime subscription acknowledgement is ambiguous"));
    return;
  }
  control.acknowledged = true;
}

function acceptChannelTerminal(state: LiveSessionState, control: StartupControl): void {
  state.channelTerminal = true;
  state.realtimeClosed = true;
  for (const resolve of state.closedWaiters) {
    resolve();
  }
  state.closedWaiters.clear();
  if (!control.settled) {
    control.reject(new Error("The realtime channel closed during startup"));
  } else if (!state.stopping) {
    failLiveState(state, "realtimeFailed");
  }
}

function createLiveReceiver(
  options: LiveEventContext,
): (connectionId: string, event: NativeLiveRealtimeEvent) => void {
  return (connectionId, event) => {
    if (connectionId !== options.home.connectionId || event.channelId !== options.state.channelId) {
      return;
    }
    if (event.event === "subscribed") {
      acceptSubscription(options.control, event, options.home);
      return;
    }
    if (event.event === "terminal") {
      acceptChannelTerminal(options.state, options.control);
      return;
    }
    if (!options.control.acknowledged) {
      options.control.reject(
        new Error("Realtime payload arrived before subscription acknowledgement"),
      );
      return;
    }
    acceptPayload(options, event);
  };
}

function boundConnectionId(
  binding: Awaited<ReturnType<GlobalSupervisorBindingOwner["read"]>>,
): string | undefined {
  if (binding?.status === "ready") {
    return binding.home.connectionId;
  }
  return binding?.status === "creating"
    ? binding.homeConnectionId
    : binding?.priorHome?.connectionId;
}

async function recoverRuntime(
  authority: GlobalSupervisorRuntimeAuthority,
  action: GlobalSupervisorRuntimeRecoveryAction,
): Promise<void> {
  const binding = authority.binding();
  switch (action) {
    case "reconnectHome": {
      const connectionId = boundConnectionId(await binding.read());
      if (connectionId !== undefined) {
        await authority.getSupervisor()?.reattachRuntime(connectionId);
      }
      return;
    }
    case "reconcileBinding":
      await binding.reconcile();
      return;
    case "recreateBinding":
      await binding.reset();
      break;
    case "chooseHome":
      break;
    case "retryCapabilityProbe":
    case "retryMicrophoneBusy":
      return;
  }
  const connectionId = authority.enabledConnectionIds()[0];
  if (connectionId === undefined) {
    throw new Error("No enabled Global Voice home server is available");
  }
  await binding.bind(connectionId);
}

/** Composes the production binding, realtime, transient event, media and cleanup owners. */
export function createGlobalSupervisorRuntime(
  authority: GlobalSupervisorRuntimeAuthority,
): GlobalSupervisorLowerRuntime {
  let activeActivationId: string | null = null;
  return {
    isActive: () => activeActivationId !== null,
    async prepare(publish) {
      await authority.ensureStarted();
      const binding = authority.binding();
      let current = await binding.read();
      if (current?.status === "creating") {
        publish(current.homeConnectionId);
        current = await binding.reconcile();
      }
      if (current === null) {
        return { recovery: "chooseHome", status: "unbound" };
      }
      if (current.status !== "ready") {
        return {
          failure: "bindingUnavailable",
          recovery: current.status === "creating" ? "reconcileBinding" : "recreateBinding",
          status: "failed",
        };
      }
      return prepareReadyHome(authority, current.home);
    },
    async recover(action) {
      await authority.ensureStarted();
      await recoverRuntime(authority, action);
    },
    async start(home, publish) {
      const startOnce = async (home: GlobalSupervisorQualifiedChatRef) => {
        await authority.ensureStarted();
        if ((await authority.requestMicrophonePermission()) !== "granted") {
          throw new GlobalSupervisorLowerRuntimeStartError(
            "microphonePermissionDenied",
            "retryMicrophoneBusy",
          );
        }
        const session = requireLiveSession(authority, home.connectionId);
        const voice = parseRealtimeV3Voice(
          await authority.rpcAfterAttach<unknown>(session, "thread/realtime/listVoices", {}),
          await authority.preferredVoice(),
        );
        const personality = await authority.personality();
        const realtimeInstructions = globalSupervisorRealtimeStartInstructions(personality);
        const activationId = authority.randomUUID();
        const recordStartupStage = (stage: GlobalSupervisorStartupStage): void => {
          authority.recordStartupStage({
            activationId,
            connectionId: home.connectionId,
            stage,
            threadId: home.threadId,
          });
        };
        recordStartupStage("activationCreated");
        const reconnectReady = Promise.withResolvers<GlobalSupervisorReconnectController>();
        const acquisition = authority.microphoneLeases.acquireGlobalSupervisor(activationId, {
          async pauseForDictation() {
            await (await reconnectReady.promise).pause();
          },
          async resumeAfterDictation() {
            await (await reconnectReady.promise).resume();
          },
        });
        if (acquisition.status === "busy") {
          throw new GlobalSupervisorLowerRuntimeStartError("microphoneBusy", "retryMicrophoneBusy");
        }
        const lease = acquisition.lease;
        const media = createGlobalSupervisorMediaOwner(authority.startWebRtc);
        let foregroundLease: Awaited<
          ReturnType<GlobalSupervisorRuntimeAuthority["acquireForegroundLease"]>
        >;
        try {
          foregroundLease = await authority.acquireForegroundLease();
        } catch (error) {
          await lease.release();
          reconnectReady.resolve({
            pause: settledReconnectOperation,
            resume: settledReconnectOperation,
            start: settledReconnectOperation,
            stop: settledReconnectOperation,
          });
          throw error;
        }
        const startTransport = async (onTerminal: () => void) => {
          const attemptSession = requireLiveSession(authority, home.connectionId);
          const supervisor = authority.getSupervisor();
          if (supervisor === null) {
            throw new Error("The Global Voice transport is unavailable");
          }
          let state: LiveSessionState | null = null;
          let control: StartupControl | null = null;
          let terminatedBeforeState = false;
          const didTerminateBeforeState = (): boolean => terminatedBeforeState;
          const webRtc = await media.start({
            mode: "interactive",
            onLevel: foregroundLease.setLevel,
            onTerminal() {
              if (state === null) {
                terminatedBeforeState = true;
              } else {
                failLiveState(state, "realtimeFailed");
              }
            },
          });
          recordStartupStage("offerReady");
          const channelId = authority.randomUUID();
          state = {
            activationId,
            attentionDelivery: null,
            channelId,
            channelTerminal: false,
            closedWaiters: new Set(),
            failurePublished: false,
            nextSequence: 1,
            onFailure(failure) {
              if (control === null || !control.settled) {
                control?.reject(new Error("Global Voice transport failed during startup"));
                return;
              }
              if (failure === "realtimeFailed") {
                onTerminal();
                return;
              }
              publish({
                activationId,
                event: "failed",
                failure,
                recovery: "reconnectHome",
              });
            },
            publish,
            realtimeClosed: false,
            realtimeSdpReceived: false,
            realtimeStarted: false,
            realtimeStartRequested: false,
            stopping: false,
            transcriptSequence: 0,
            webRtc,
          };
          if (didTerminateBeforeState()) {
            await webRtc.stop().catch(() => undefined);
            throw new Error("Global Voice WebRTC media terminated during startup");
          }
          let subscribed = false;
          const startup = Promise.withResolvers<undefined>();
          control = {
            acknowledged: false,
            reject(error) {
              if (control !== null && !control.settled) {
                control.settled = true;
                startup.reject(error);
              }
            },
            resolve() {
              if (control !== null && !control.settled) {
                control.settled = true;
                startup.resolve(undefined);
              }
            },
            settled: false,
          };
          const liveSubscription = authority.ingress.subscribeLive(
            createLiveReceiver({ control, home, recordStartupStage, state }),
          );
          try {
            await supervisor.subscribeLive(home.connectionId, channelId, home.threadId);
            recordStartupStage("subscriptionReady");
            subscribed = true;
            state.realtimeStartRequested = true;
            await authority.rpcAfterAttach(attemptSession, "thread/realtime/start", {
              includeStartupContext: false,
              outputModality: "audio",
              realtimeStartInstructions: realtimeInstructions,
              threadId: home.threadId,
              transport: { sdp: webRtc.offerSdp, type: "webrtc" },
              version: "v3",
              voice,
            });
            recordStartupStage("startAccepted");
            await withTimeout(startup.promise, globalSupervisorLimitsV1.realtimeStartupTimeoutMs);
          } catch (error) {
            await webRtc.stop().catch(() => undefined);
            liveSubscription.unsubscribe();
            if (subscribed) {
              await supervisor.unsubscribeLive(home.connectionId, channelId).catch(() => {
                // Startup cleanup is best-effort; the original startup rejection remains authoritative.
              });
            }
            throw error;
          }
          const eventSignals = createGlobalSupervisorEventSignalSession({
            appendText: async (text) => {
              await authority.rpcAfterAttach(attemptSession, "thread/realtime/appendText", {
                role: "developer",
                text,
                threadId: home.threadId,
              });
            },
            home,
            ingress: authority.ingress,
            now: authority.now,
            onTerminal: () => {
              failLiveState(state, "realtimeFailed");
            },
            realtimeInstructions,
          });
          const attentionDelivery = createGlobalSupervisorAttentionDeliverySession({
            appendText: async (text) => {
              await authority.rpcAfterAttach(attemptSession, "thread/realtime/appendText", {
                role: "developer",
                text,
                threadId: home.threadId,
              });
            },
            attention: authority.attention,
            home,
            onTerminal: () => {
              failLiveState(state, "realtimeFailed");
            },
          });
          state.attentionDelivery = attentionDelivery;
          attentionDelivery.setSpeechBusy(false);
          let stopped = false;
          return {
            async stop(): Promise<void> {
              if (stopped) {
                return;
              }
              stopped = true;
              state.stopping = true;
              const failures: unknown[] = [];
              const recordFailure = (error: unknown): void => {
                failures.push(error);
              };
              // Release device capture before any delivery or network drain. Those queues may
              // legitimately take seconds, but they do not own the local microphone.
              await state.webRtc.stop().catch(recordFailure);
              await attentionDelivery.stop().catch(recordFailure);
              await eventSignals.stop().catch(recordFailure);
              if (!state.realtimeClosed) {
                await withTimeout(
                  authority.rpcAfterAttach(attemptSession, "thread/realtime/stop", {
                    threadId: home.threadId,
                  }),
                  globalSupervisorLimitsV1.realtimeStopCloseTimeoutMs,
                ).catch(recordFailure);
              }
              if (!state.realtimeClosed) {
                const closed = new Promise<void>((resolve) => {
                  state.closedWaiters.add(resolve);
                });
                await withTimeout(
                  closed,
                  globalSupervisorLimitsV1.realtimeStopCloseTimeoutMs,
                ).catch(recordFailure);
              }
              if (!state.channelTerminal) {
                const terminal = new Promise<void>((resolve) => {
                  state.closedWaiters.add(resolve);
                });
                await withTimeout(
                  supervisor.unsubscribeLive(home.connectionId, channelId),
                  globalSupervisorLimitsV1.realtimeStopCloseTimeoutMs,
                ).catch(recordFailure);
                await withTimeout(
                  terminal,
                  globalSupervisorLimitsV1.realtimeStopCloseTimeoutMs,
                ).catch(recordFailure);
              }
              liveSubscription.unsubscribe();
              if (failures.length > 0) {
                throw new Error("Global Voice transport cleanup failed");
              }
            },
          };
        };
        const reconnect = createGlobalSupervisorReconnectOwner({
          onExhausted() {
            publish({
              activationId,
              event: "failed",
              failure: "realtimeFailed",
              recovery: "reconnectHome",
            });
          },
          onReconnecting() {
            publish({ activationId, event: "reconnecting" });
          },
          policy: authority.reconnectPolicy ?? GLOBAL_SUPERVISOR_RECONNECT_POLICY,
          startTransport,
        });
        reconnectReady.resolve(reconnect);
        try {
          await reconnect.start();
        } catch (error) {
          await foregroundLease.release().catch(() => undefined);
          await lease.release();
          throw error;
        }
        activeActivationId = activationId;
        let cleanupPromise: Promise<void> | null = null;
        return {
          activationId,
          home: globalSupervisorQualifiedChatRef(home.connectionId, home.threadId),
          pause: reconnect.pause,
          resume: reconnect.resume,
          async stop() {
            cleanupPromise ??= (async () => {
              if (activeActivationId === activationId) {
                activeActivationId = null;
              }
              const failures: unknown[] = [];
              const mediaClosed = media.close();
              const transportCleanup = reconnect.stop();
              await mediaClosed;
              const overlayCleanup = foregroundLease.release();
              await lease.release();
              await overlayCleanup.catch((error: unknown) => failures.push(error));
              await authority.attention
                .disableDelivery(home)
                .catch((error: unknown) => failures.push(error));
              await transportCleanup.catch((error: unknown) => failures.push(error));
              if (failures.length > 0) {
                throw new Error("Global Voice runtime cleanup failed");
              }
            })();
            await cleanupPromise;
          },
        };
      };
      const startWithDelivery = async (target: GlobalSupervisorQualifiedChatRef) => {
        await authority.attention.enableDelivery(target);
        try {
          return await startOnce(target);
        } catch (error) {
          await authority.attention.disableDelivery(target);
          throw error;
        }
      };
      try {
        return await startWithDelivery(home);
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
      return startWithDelivery(replacement);
    },
  };
}
