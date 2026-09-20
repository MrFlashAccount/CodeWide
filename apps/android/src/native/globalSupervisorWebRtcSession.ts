// Metro selects `.native` on Android and `.web` in the browser. Unit tests use
// this fallback without loading the native WebRTC package.
export * from "./globalSupervisorWebRtcSession.web";
