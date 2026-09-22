import { observablePrimitive, type ObservablePrimitive } from "@legendapp/state";

import {
  readGlobalVoiceAudioInput,
  selectGlobalVoiceAudioInput,
  subscribeGlobalVoiceAudioInput,
} from "../native/globalVoiceAudioRoute";
import type { VoiceInputKind, VoiceInputSnapshot } from "../native/globalVoiceAudioRouteContract";

type InputResource =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: VoiceInputSnapshot }
  | { readonly message: string; readonly status: "unavailable" };

const state$ = observablePrimitive<InputResource>({ status: "loading" });
let loading: Promise<void> | null = null;
let version = 0;

function publish(value: VoiceInputSnapshot): void {
  version += 1;
  state$.set({ status: "ready", value });
}

async function load(): Promise<void> {
  try {
    // This is a process-owned source; settings unmount must not dispose live device observation.
    subscribeGlobalVoiceAudioInput(publish);
    const expectedVersion = version;
    const snapshot = await readGlobalVoiceAudioInput();
    if (version === expectedVersion) {
      publish(snapshot);
    }
  } catch {
    state$.set({
      message: "Microphone routing is unavailable in this build.",
      status: "unavailable",
    });
  }
}

/** Starts one model-owned hydration and returns its live progressive snapshot. */
export function globalVoiceAudioInputResource(): ObservablePrimitive<InputResource> {
  loading ??= load();
  return state$;
}

/** Applies and persists an explicit user selection through the native route owner. */
export async function selectVoiceInput(kind: VoiceInputKind, id: number | null): Promise<void> {
  publish(await selectGlobalVoiceAudioInput(kind, id));
}
