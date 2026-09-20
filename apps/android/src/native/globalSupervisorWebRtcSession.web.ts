import type {
  GlobalSupervisorWebRtcSession,
  GlobalSupervisorWebRtcSessionFactory,
} from "./globalSupervisorWebRtcSessionContract";

/** Global Voice media is available only in the Android application. */
// WHY: This platform adapter must preserve the asynchronous factory contract while always rejecting.
// oxlint-disable-next-line typescript/require-await
async function rejectWebRtcSession(): Promise<GlobalSupervisorWebRtcSession> {
  throw new Error("Global Voice WebRTC is available on Android only");
}

export const createGlobalSupervisorWebRtcSession: GlobalSupervisorWebRtcSessionFactory =
  rejectWebRtcSession;
