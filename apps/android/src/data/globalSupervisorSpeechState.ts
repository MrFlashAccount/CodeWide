import type { SyncEvent } from "@codewide/sync-client";

import type { GlobalSupervisorQualifiedChatRef } from "./globalSupervisorBinding";
import { unknownRecord } from "./unknownRecord";

type SpeechPhase = "listening" | "thinking" | "speaking";
const PLAYBACK_ONSET = 0.001;
const PLAYBACK_RELEASE_MS = 450;

type GlobalSupervisorSpeechState = {
  readonly acceptItem: (item: unknown) => void;
  readonly acceptThreadEvents: (connectionId: string, events: readonly SyncEvent[]) => void;
  readonly acceptTranscript: (role: "user" | "assistant", completed: boolean) => void;
  readonly setPlaybackLevel: (level: number) => void;
  readonly setUserSpeaking: (speaking: boolean) => void;
  readonly start: () => void;
  readonly stop: () => void;
};

type Activity =
  | { readonly kind: "started" | "completed"; readonly turnId: string }
  | { readonly kind: "busy" | "idle" };

function readStatus(status: unknown): Activity | null {
  const value = unknownRecord(status);
  if (value?.type === "active") {
    return { kind: "busy" };
  }
  if (value?.type === "idle" || value?.type === "systemError") {
    return { kind: "idle" };
  }
  return null;
}

function readActivity(method: unknown, params: Readonly<Record<string, unknown>>): Activity | null {
  if (method === "thread/status/changed") {
    return readStatus(params.status);
  }
  if (method === "item/started") {
    return typeof params.turnId === "string" ? { kind: "started", turnId: params.turnId } : null;
  }
  const turn = unknownRecord(params.turn);
  if (typeof turn?.id !== "string") {
    return null;
  }
  if (method === "turn/started") {
    return { kind: "started", turnId: turn.id };
  }
  if (method === "turn/completed") {
    return { kind: "completed", turnId: turn.id };
  }
  return null;
}

function speechPhase(userSpeaking: boolean, playbackActive: boolean, busy: boolean): SpeechPhase {
  if (userSpeaking) {
    return "listening";
  }
  if (playbackActive) {
    return "speaking";
  }
  return busy ? "thinking" : "listening";
}

/** Reduces independent live speech, playback and home-thread activity into one display phase. */
export function createGlobalSupervisorSpeechState(options: {
  readonly home: GlobalSupervisorQualifiedChatRef;
  readonly now: () => number;
  readonly publish: (phase: SpeechPhase) => void;
}): GlobalSupervisorSpeechState {
  let accepting = true;
  let started = false;
  let phase: SpeechPhase | null = null;
  let userSpeaking = false;
  let hasVad = false;
  let awaitingResponse = false;
  let activeTurnId: string | null = null;
  let threadBusy = false;
  let playbackUntil = -Infinity;

  const publish = (): void => {
    if (!accepting || !started) {
      return;
    }
    // Confirmed user speech wins barge-in; transcript completion never means playback drained.
    const next = speechPhase(
      userSpeaking,
      options.now() < playbackUntil,
      activeTurnId !== null || threadBusy || awaitingResponse,
    );
    if (next === phase) {
      return;
    }
    phase = next;
    options.publish(next);
  };

  const applyActivity = (activity: Activity | null): void => {
    if (activity === null) {
      return;
    }
    switch (activity.kind) {
      case "started":
        activeTurnId = activity.turnId;
        awaitingResponse = false;
        break;
      case "completed":
        if (activity.turnId === activeTurnId) {
          activeTurnId = null;
        }
        break;
      case "busy":
        threadBusy = true;
        break;
      case "idle":
        threadBusy = false;
        activeTurnId = null;
        break;
    }
  };

  return {
    acceptItem(item: unknown): void {
      if (!accepting) {
        return;
      }
      const value = unknownRecord(item);
      if (
        value?.role === "user" ||
        value?.role === "assistant" ||
        value?.type === "function_call"
      ) {
        awaitingResponse = true;
        publish();
      }
    },
    acceptThreadEvents(connectionId: string, events: readonly SyncEvent[]): void {
      if (!accepting || connectionId !== options.home.connectionId) {
        return;
      }
      for (const event of events) {
        const params = unknownRecord(event.payload.params);
        if (params?.threadId !== options.home.threadId) {
          continue;
        }
        applyActivity(readActivity(event.payload.method, params));
      }
      publish();
    },
    acceptTranscript(role: "user" | "assistant", completed: boolean): void {
      if (!accepting) {
        return;
      }
      if (role === "user") {
        if (!hasVad) {
          userSpeaking = !completed;
        }
        awaitingResponse = completed;
      } else if (completed) {
        awaitingResponse = false;
      }
      publish();
    },
    setPlaybackLevel(level: number): void {
      if (!accepting) {
        return;
      }
      if (Number.isFinite(level) && level > PLAYBACK_ONSET) {
        playbackUntil = options.now() + PLAYBACK_RELEASE_MS;
        awaitingResponse = false;
      }
      publish();
    },
    setUserSpeaking(speaking: boolean): void {
      if (!accepting) {
        return;
      }
      hasVad = true;
      userSpeaking = speaking;
      awaitingResponse = !speaking;
      if (speaking) {
        playbackUntil = -Infinity;
      }
      publish();
    },
    start(): void {
      started = true;
      publish();
    },
    stop(): void {
      accepting = false;
    },
  };
}
