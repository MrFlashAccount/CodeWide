// Metro selects `.native` on Android and `.web` in the browser. Tooling and
// platform-neutral tests use the no-op web binding.
export * from "./globalVoiceOverlayBinding.web";
