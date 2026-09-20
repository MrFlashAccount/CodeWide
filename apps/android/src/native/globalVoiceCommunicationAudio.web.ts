import type { GlobalVoiceCommunicationAudioLease } from "./globalVoiceCommunicationAudioContract";

const RESOLVED_VOID_PROMISE = Promise.resolve();

/** Browser builds do not own Android communication mode. */
export async function acquireGlobalVoiceCommunicationAudio(): Promise<GlobalVoiceCommunicationAudioLease> {
  await RESOLVED_VOID_PROMISE;
  throw new Error("Global Voice communication audio is unavailable outside Android");
}
