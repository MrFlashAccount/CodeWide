import type { VoiceInputKind, VoiceInputSnapshot } from "./globalVoiceAudioRouteContract";

/** Audio-device routing is available only on Android. */
// WHY: The platform stub preserves the async native API while failing before any operation.
// oxlint-disable-next-line typescript/require-await
export async function readGlobalVoiceAudioInput(): Promise<VoiceInputSnapshot> {
  throw new Error("Microphone routing is available only on Android");
}

/** Web has no Android route notifications. */
export function subscribeGlobalVoiceAudioInput(
  _onChange: (snapshot: VoiceInputSnapshot) => void,
): () => void {
  return () => undefined;
}

/** Rejects native input selection on unsupported platforms. */
export async function selectGlobalVoiceAudioInput(
  _kind: VoiceInputKind,
  _id: number | null,
): Promise<VoiceInputSnapshot> {
  return readGlobalVoiceAudioInput();
}
