import type { V2Projection } from "@codewide/sync-client/v2";
import { useSyncExternalStore } from "react";

import { useProcessBinding } from "../../../boot/useProcessBinding";
import { useEvent } from "../../../react/useEvent";
import {
  voiceInputScopeKey,
  type VoiceInputBinding,
  type VoiceInputState,
} from "../../application/voiceInputController";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { SavedServerId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import type { VoiceInputScope } from "../../domain/voiceInputScope";

type VoiceInputControlState = Exclude<VoiceInputState, "cancelling">;

export interface VoiceInputControlModel {
  activate(): Promise<void>;
  cancel(): Promise<void>;
  captureState: VoiceInputState;
  disabled: boolean;
  finishTranscript(): Promise<void>;
  message: string | null;
  retry(): Promise<void>;
  startedAtMs: number | null;
  state: VoiceInputControlState;
  submitTranscript(): Promise<void>;
}

interface UseVoiceInputControlInput {
  audience: SavedServerId;
  live: boolean;
  onSubmitTranscript?(text: string): Promise<boolean>;
  onTranscript(text: string): void;
  projection: V2Projection | null;
  scope: VoiceInputScope;
  thread: QualifiedThread | null;
}

type UseSavedServerVoiceInputControlInput = Omit<UseVoiceInputControlInput, "live" | "projection">;

/** Reads the live saved-server generation for a process-owned Voice input binding. */
export function useSavedServerVoiceInputControl(
  input: UseSavedServerVoiceInputControlInput,
): VoiceInputControlModel {
  const runtime = useV2Runtime();
  const resource = runtime.sessions.resource(input.audience);
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  return useVoiceInputControl({
    ...input,
    live: snapshot.value.state === "live" && snapshot.value.projections.live !== null,
    projection: snapshot.value.projections.live,
  });
}

/** Binds one composer to process-owned Voice state without owning capture lifetime. */
export function useVoiceInputControl(input: UseVoiceInputControlInput): VoiceInputControlModel {
  const runtime = useV2Runtime();
  const { audience, live, onSubmitTranscript, onTranscript, projection, scope, thread } = input;
  const usable = live && projection !== null;
  const binding = (): VoiceInputBinding | null =>
    projection === null
      ? null
      : {
          audience,
          onTranscript,
          scope,
          sourceGeneration: projection.sourceGeneration,
          thread,
          ...(onSubmitTranscript === undefined ? {} : { onSubmitTranscript }),
        };
  const bindingIdentity = voiceInputScopeKey(audience, scope);
  const subscribe = (listener: () => void): (() => void) =>
    runtime.voice.subscribe(bindingIdentity, listener);
  const readSnapshot = (): ReturnType<typeof runtime.voice.snapshot> =>
    runtime.voice.snapshot(bindingIdentity);
  const scopedSnapshot = useSyncExternalStore(subscribe, readSnapshot, readSnapshot);
  const subscribeActive = (listener: () => void): (() => void) =>
    runtime.voice.subscribeActive(listener);
  const readActiveSnapshot = (): ReturnType<typeof runtime.voice.activeSnapshot> =>
    runtime.voice.activeSnapshot();
  const activeSnapshot = useSyncExternalStore(
    subscribeActive,
    readActiveSnapshot,
    readActiveSnapshot,
  );
  const snapshot = activeSnapshot.state === "idle" ? scopedSnapshot : activeSnapshot;
  const bind = useEvent((): (() => void) => {
    const current = binding();
    return current === null ? () => undefined : runtime.voice.bind(current);
  });
  useProcessBinding(bindingIdentity, bind);

  const activate = useEvent(async (): Promise<void> => {
    const active = snapshot.state !== "idle" && snapshot.state !== "error";
    if ((!usable && !active) || snapshot.state === "finishing" || snapshot.state === "cancelling")
      return;
    await runtime.voice.activate(binding());
  });
  const cancel = useEvent(async (): Promise<void> => {
    await runtime.voice.cancel();
  });
  const finishTranscript = useEvent(async (): Promise<void> => {
    await runtime.voice.finish(false);
  });
  const retry = useEvent(async (): Promise<void> => {
    await runtime.voice.retry();
  });
  const submitTranscript = useEvent(async (): Promise<void> => {
    await runtime.voice.finish(true);
  });
  const active = snapshot.state !== "idle" && snapshot.state !== "error";

  return {
    activate,
    cancel,
    captureState: snapshot.state,
    disabled:
      snapshot.state === "finishing" || snapshot.state === "cancelling" || (!active && !usable),
    finishTranscript,
    message:
      !active && !usable
        ? "Voice input requires a live saved-server connection."
        : snapshot.message,
    retry,
    startedAtMs: snapshot.startedAtMs ?? null,
    state: snapshot.state === "cancelling" ? "finishing" : snapshot.state,
    submitTranscript,
  };
}

/** Subscribes only a small meter surface to transient native microphone levels. */
export function useVoiceInputLevel(audience: SavedServerId, scope: VoiceInputScope): number {
  const runtime = useV2Runtime();
  const key = voiceInputScopeKey(audience, scope);
  const subscribeScoped = (listener: () => void): (() => void) =>
    runtime.voice.subscribeLevel(key, listener);
  const readScopedLevel = (): number => runtime.voice.level(key);
  const scopedLevel = useSyncExternalStore(subscribeScoped, readScopedLevel, readScopedLevel);
  const subscribeActive = (listener: () => void): (() => void) =>
    runtime.voice.subscribeActiveLevel(listener);
  const readActiveLevel = (): number => runtime.voice.activeLevel();
  const activeLevel = useSyncExternalStore(subscribeActive, readActiveLevel, readActiveLevel);
  const subscribeActiveState = (listener: () => void): (() => void) =>
    runtime.voice.subscribeActive(listener);
  const readActiveState = (): ReturnType<typeof runtime.voice.activeSnapshot> =>
    runtime.voice.activeSnapshot();
  const activeState = useSyncExternalStore(subscribeActiveState, readActiveState, readActiveState);
  return activeState.state === "idle" ? scopedLevel : activeLevel;
}
