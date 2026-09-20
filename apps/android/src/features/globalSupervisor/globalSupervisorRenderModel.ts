import { observablePrimitive, type ObservablePrimitive } from "@legendapp/state";

import type {
  GlobalSupervisorFailureKind,
  GlobalSupervisorHome,
  GlobalSupervisorPreparation,
  GlobalSupervisorPreparationProgress,
  GlobalSupervisorRecovery,
  GlobalSupervisorRenderSnapshot,
  GlobalSupervisorRuntimeEvent,
} from "./globalSupervisorContract";

const INITIAL_SNAPSHOT: GlobalSupervisorRenderSnapshot = {
  activity: null,
  home: null,
  phase: "unbound",
  recovery: { action: "chooseHome", label: "Choose home server" },
  target: null,
  transcript: [],
};

function failureSummary(failure: GlobalSupervisorFailureKind): string {
  switch (failure) {
    case "bindingUnavailable":
      return "The supervisor binding needs repair.";
    case "capabilityUnavailable":
      return "Global Voice Mode is unavailable on this server.";
    case "cleanupFailed":
      return "Global Voice Mode could not stop cleanly.";
    case "homeUnavailable":
      return "The home server is unavailable.";
    case "microphoneBusy":
      return "The microphone is already in use.";
    case "microphonePermissionDenied":
      return "Microphone access is required.";
    case "preparationFailed":
      return "Global Voice Mode could not be prepared.";
    case "realtimeFailed":
      return "The live voice session ended unexpectedly.";
    case "sessionAmbiguous":
      return "The live voice session lost synchronization.";
    case "startFailed":
      return "Global Voice Mode could not start.";
    default:
      return unreachableFailure(failure);
  }
}

function unreachableFailure(failure: never): never {
  throw new Error(`Unhandled Global Voice failure: ${String(failure)}`);
}

function readySnapshot(home: GlobalSupervisorHome): GlobalSupervisorRenderSnapshot {
  return {
    activity: null,
    home,
    phase: "ready",
    recovery: null,
    target: null,
    transcript: [],
  };
}

/** Stable render resource plus explicit state-publication operations. */
export type GlobalSupervisorRenderModel = {
  readonly fail: (failure: GlobalSupervisorFailureKind, recovery: GlobalSupervisorRecovery) => void;
  readonly publishActivating: () => void;
  readonly publishPreparation: (preparation: GlobalSupervisorPreparation) => void;
  readonly publishPreparationProgress: (progress: GlobalSupervisorPreparationProgress) => void;
  readonly publishReady: (home: GlobalSupervisorHome) => void;
  readonly publishRuntimeEvent: (event: GlobalSupervisorRuntimeEvent) => void;
  readonly publishStarting: (home: GlobalSupervisorHome) => void;
  readonly publishStopping: (home: GlobalSupervisorHome) => void;
  readonly render$: ObservablePrimitive<GlobalSupervisorRenderSnapshot>;
};

/** Owns pure render-state reduction and the stable Legend resource. */
export function createGlobalSupervisorRenderModel(): GlobalSupervisorRenderModel {
  const render$ = observablePrimitive<GlobalSupervisorRenderSnapshot>(INITIAL_SNAPSHOT);

  const fail = (failure: GlobalSupervisorFailureKind, recovery: GlobalSupervisorRecovery): void => {
    const previous = render$.peek();
    render$.set({
      activity: null,
      failureSummary: failureSummary(failure),
      home: previous.home,
      phase: "failed",
      recovery,
      target: null,
      transcript: [],
    });
  };

  return {
    fail,
    publishActivating() {
      const current = render$.peek();
      render$.set({
        activity: null,
        home: current.home,
        phase: "activating",
        recovery: null,
        target: null,
        transcript: [],
      });
    },
    publishPreparation(preparation) {
      if (preparation.status === "ready") {
        render$.set(readySnapshot(preparation.home));
      } else if (preparation.status === "unbound") {
        render$.set({
          activity: null,
          home: null,
          phase: "unbound",
          recovery: preparation.recovery,
          target: null,
          transcript: [],
        });
      } else {
        fail(preparation.failure, preparation.recovery);
      }
    },
    publishPreparationProgress(progress) {
      render$.set({
        activity: null,
        home: { connectionId: progress.homeConnectionId, threadId: null },
        phase: "creating",
        recovery: null,
        target: null,
        transcript: [],
      });
    },
    publishReady(home) {
      render$.set(readySnapshot(home));
    },
    publishRuntimeEvent(event) {
      if (event.event === "failed") {
        fail(event.failure, event.recovery);
        return;
      }
      const current = render$.peek();
      if (current.home === null || current.home.threadId === null || current.phase === "failed") {
        return;
      }
      if (event.event === "transcript") {
        render$.set({
          ...current,
          transcript: [...current.transcript, event.item],
        });
      } else if (event.event === "toolActivity") {
        render$.set({
          activity: event.label,
          home: current.home,
          phase: "toolActivity",
          recovery: null,
          target: event.target,
          transcript: current.transcript,
        });
      } else {
        render$.set({
          activity: null,
          home: current.home,
          phase: event.event,
          recovery: null,
          target: null,
          transcript: current.transcript,
        });
      }
    },
    publishStarting(home) {
      render$.set({
        activity: null,
        home,
        phase: "starting",
        recovery: null,
        target: null,
        transcript: [],
      });
    },
    publishStopping(home) {
      render$.set({
        activity: null,
        home,
        phase: "stopping",
        recovery: null,
        target: null,
        transcript: [],
      });
    },
    render$,
  };
}
