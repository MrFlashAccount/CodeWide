import type { ObservablePrimitive } from "@legendapp/state";

import type { GlobalSupervisorQualifiedChatRef } from "../../data/globalSupervisorBinding";

/** Qualified App Server thread that owns or receives supervisor work. */
export type GlobalSupervisorHome = GlobalSupervisorQualifiedChatRef;

/** Bounded live transcript row shown only during the current activation. */
type GlobalSupervisorTranscriptItem = {
  readonly id: string;
  readonly role: "supervisor" | "user";
  readonly text: string;
};

/** Explicit recovery action exposed by the supervisor state machine. */
export type GlobalSupervisorRecovery =
  | { readonly action: "chooseHome"; readonly label: "Choose home server" }
  | { readonly action: "reconnectHome"; readonly label: "Reconnect home server" }
  | { readonly action: "retryCapabilityProbe"; readonly label: "Retry voice check" }
  | { readonly action: "retryMicrophoneBusy"; readonly label: "Try microphone again" }
  | { readonly action: "reconcileBinding"; readonly label: "Repair supervisor binding" }
  | { readonly action: "recreateBinding"; readonly label: "Recreate supervisor" };

/** Closed failure classification safe to project into fixed user-facing copy. */
export type GlobalSupervisorFailureKind =
  | "bindingUnavailable"
  | "capabilityUnavailable"
  | "cleanupFailed"
  | "homeUnavailable"
  | "microphoneBusy"
  | "microphonePermissionDenied"
  | "preparationFailed"
  | "realtimeFailed"
  | "sessionAmbiguous"
  | "startFailed";

/** Fixed, content-free activation rejection that carries a renderable recovery. */
export class GlobalSupervisorStartError extends Error {
  readonly failure: GlobalSupervisorFailureKind;
  readonly recovery: GlobalSupervisorRecovery;

  constructor(failure: GlobalSupervisorFailureKind, recovery: GlobalSupervisorRecovery) {
    super("Global Voice Mode could not start");
    this.name = "GlobalSupervisorStartError";
    this.failure = failure;
    this.recovery = recovery;
  }
}

type EmptyPresentation = {
  readonly activity: null;
  readonly target: null;
  readonly transcript: readonly GlobalSupervisorTranscriptItem[];
};

type ReadyPresentation = EmptyPresentation & {
  readonly home: GlobalSupervisorHome;
  readonly phase: "ready";
  readonly recovery: null;
};

type LivePresentation = {
  readonly activity: null;
  readonly home: GlobalSupervisorHome;
  readonly recovery: null;
  readonly target: null;
  readonly transcript: readonly GlobalSupervisorTranscriptItem[];
};

/** Stable, contradiction-free render projection consumed by the screen. */
export type GlobalSupervisorRenderSnapshot =
  | (EmptyPresentation & {
      readonly home: null;
      readonly phase: "unbound";
      readonly recovery: GlobalSupervisorRecovery;
    })
  | (EmptyPresentation & {
      readonly home:
        | GlobalSupervisorHome
        | { readonly connectionId: string; readonly threadId: null }
        | null;
      readonly phase: "activating";
      readonly recovery: null;
    })
  | (EmptyPresentation & {
      readonly home: { readonly connectionId: string; readonly threadId: null };
      readonly phase: "creating";
      readonly recovery: null;
    })
  | ReadyPresentation
  | (LivePresentation & { readonly phase: "starting" })
  | (LivePresentation & {
      readonly phase: "listening" | "reconnecting" | "speaking" | "thinking";
    })
  | {
      readonly activity: string;
      readonly home: GlobalSupervisorHome;
      readonly phase: "toolActivity";
      readonly recovery: null;
      readonly target: GlobalSupervisorHome | null;
      readonly transcript: readonly GlobalSupervisorTranscriptItem[];
    }
  | (EmptyPresentation & {
      readonly home: GlobalSupervisorHome;
      readonly phase: "stopping";
      readonly recovery: null;
    })
  | {
      readonly activity: null;
      readonly failureSummary: string;
      readonly home:
        | GlobalSupervisorHome
        | { readonly connectionId: string; readonly threadId: null }
        | null;
      readonly phase: "failed";
      readonly recovery: GlobalSupervisorRecovery;
      readonly target: null;
      readonly transcript: readonly GlobalSupervisorTranscriptItem[];
    };

/** Validated live event published by the supervisor runtime. */
export type GlobalSupervisorRuntimeEvent = { readonly activationId: string } & (
  | { readonly event: "listening" }
  | { readonly event: "reconnecting" }
  | { readonly event: "thinking" }
  | { readonly event: "speaking" }
  | {
      readonly event: "transcript";
      readonly item: GlobalSupervisorTranscriptItem;
    }
  | {
      readonly event: "toolActivity";
      readonly label: string;
      readonly target: GlobalSupervisorHome | null;
    }
  | {
      readonly event: "failed";
      readonly failure: GlobalSupervisorFailureKind;
      readonly recovery: GlobalSupervisorRecovery;
    }
);

/** Live supervisor activation and its exact cleanup capability. */
export type GlobalSupervisorActivation = {
  readonly activationId: string;
  readonly home: GlobalSupervisorHome;
  readonly pause: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly setMicrophoneMuted: (muted: boolean) => Promise<void>;
  readonly stop: () => Promise<void>;
};

/** Preparation progress published before the durable create call settles. */
export type GlobalSupervisorPreparationProgress = {
  readonly homeConnectionId: string;
  readonly status: "creating";
};

/** Result of preparing the durable home binding and live capability. */
export type GlobalSupervisorPreparation =
  | { readonly home: GlobalSupervisorHome; readonly status: "ready" }
  | { readonly recovery: GlobalSupervisorRecovery; readonly status: "unbound" }
  | {
      readonly failure: GlobalSupervisorFailureKind;
      readonly recovery: GlobalSupervisorRecovery;
      readonly status: "failed";
    };

/** Runtime boundary for preparation, recovery, activation and terminal cleanup. */
export type GlobalSupervisorRuntime = {
  readonly prepare: (
    publish: (progress: GlobalSupervisorPreparationProgress) => void,
  ) => Promise<GlobalSupervisorPreparation>;
  readonly recover: (recovery: GlobalSupervisorRecovery) => Promise<void>;
  readonly start: (
    home: GlobalSupervisorHome,
    publish: (event: GlobalSupervisorRuntimeEvent) => void,
  ) => Promise<GlobalSupervisorActivation>;
};

/** Stable feature resource and user actions owned by Global Voice Mode. */
export type GlobalSupervisorFeature = {
  readonly enter: () => Promise<void>;
  readonly microphoneMuted$: ObservablePrimitive<boolean>;
  readonly pause: () => Promise<void>;
  readonly recover: () => Promise<void>;
  readonly render$: ObservablePrimitive<GlobalSupervisorRenderSnapshot>;
  readonly resume: () => Promise<void>;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly toggle: () => Promise<void>;
  readonly toggleMicrophone: () => Promise<void>;
};
