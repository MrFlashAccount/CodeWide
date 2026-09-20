/** Scoped Android communication-audio lease owned by one interactive Global Voice session. */
export type GlobalVoiceCommunicationAudioLease = {
  readonly release: () => Promise<void>;
};
