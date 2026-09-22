import type {
  PersonalVoiceEnrollmentResult,
  PersonalVoiceFilterDecision,
  PersonalVoiceFilterLease,
} from "./personalVoiceFilterContract";

export function hasPersonalVoiceProfile(): boolean {
  return false;
}

// WHY: The web platform stub preserves the asynchronous native adapter contract while failing before any operation can start.
// oxlint-disable-next-line typescript/require-await
export async function enrollPersonalVoice(): Promise<PersonalVoiceEnrollmentResult> {
  throw new Error("Personal voice filtering is available only on Android");
}

// WHY: The web platform stub preserves the asynchronous native adapter contract while reporting that no native lease exists.
// oxlint-disable-next-line typescript/require-await
export async function startPersonalVoiceFilter(
  _onDecision: (decision: PersonalVoiceFilterDecision) => void,
): Promise<PersonalVoiceFilterLease | null> {
  return null;
}
