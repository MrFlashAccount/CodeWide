/** Optional native geometry recorder; older APKs and web expose no controls. */
export type WindowDiagnosticsPort =
  | { readonly status: "unavailable" }
  | {
      readonly captureReport: () => Promise<string>;
      readonly getRecording: () => Promise<boolean>;
      readonly setRecording: (enabled: boolean) => Promise<boolean>;
      readonly status: "available";
    };
