/** Native enrollment result for the device-local personal voice profile. */
export type PersonalVoiceEnrollmentResult = {
  readonly hasProfile: true;
};

/** Active native speaker gate controlling one Global Voice microphone track. */
export type PersonalVoiceFilterLease = {
  readonly stop: () => void;
};

/** One bounded speaker-match decision emitted by the device-local filter. */
export type PersonalVoiceFilterDecision = {
  readonly open: boolean;
  readonly similarity: number;
};
