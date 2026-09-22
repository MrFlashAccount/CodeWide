import { observable, type Observable } from "@legendapp/state";

import { windowDiagnosticsPort } from "../native/windowDiagnostics";
import { WindowDiagnosticDimensions } from "./windowDiagnosticDimensions";
import { workspaceCatalogDiagnostics } from "./workspaceCatalogDiagnostics";

/** Session status shared by settings mounts; measurement remains outside React. */
type WindowDiagnosticState =
  | { readonly status: "unavailable" }
  | { readonly status: "loading" }
  | { readonly message: string; readonly status: "load-error" }
  | { readonly recording: boolean; readonly status: "ready" }
  | { readonly recording: boolean; readonly status: "changing" }
  | { readonly message: string; readonly recording: boolean; readonly status: "error" };

const port = windowDiagnosticsPort();
const state$ = observable<{ readonly value: WindowDiagnosticState }>({
  value: { status: port.status === "available" ? "loading" : "unavailable" },
});
function publish(value: WindowDiagnosticState): void {
  state$.set({ value });
}
const dimensions = new WindowDiagnosticDimensions();
let initialization: Promise<void> | null = null;

/** Starts one cached native status read during resource selection, never from a React effect. */
export function windowDiagnosticResource(): Observable<{ readonly value: WindowDiagnosticState }> {
  if (port.status === "available" && initialization === null) {
    initialization = port.getRecording().then(
      (recording) => {
        if (recording) {
          dimensions.start();
        }
        publish({ recording, status: "ready" });
      },
      () => {
        publish({
          message: "Could not read window diagnostics. Reopen the app to retry.",
          status: "load-error",
        });
      },
    );
  }
  return state$;
}

/** Changes observation only; disabling preserves the report, enabling starts a new session. */
export async function setWindowDiagnosticRecording(recording: boolean): Promise<void> {
  const previous = state$.peek().value;
  if (
    port.status === "unavailable" ||
    previous.status === "loading" ||
    previous.status === "load-error" ||
    previous.status === "unavailable" ||
    previous.status === "changing"
  ) {
    return;
  }
  publish({ recording: previous.recording, status: "changing" });
  try {
    const enabled = await port.setRecording(recording);
    if (enabled) {
      dimensions.start();
    } else {
      dimensions.stop();
    }
    publish({ recording: enabled, status: "ready" });
  } catch {
    publish({
      message: "Could not change window diagnostics. Try again.",
      recording: previous.recording,
      status: "error",
    });
  }
}

/** Exports native geometry history and JS Dimensions, with timestamps for correlation. */
export async function captureWindowDiagnosticReport(): Promise<string> {
  if (port.status === "unavailable") {
    throw new Error("Window diagnostics requires an updated Android app");
  }
  const native = await port.captureReport();
  return `CodeWide window diagnostics v1\n\nNative geometry\n${native}\n\nJavaScript Dimensions\n${dimensions.report()}\n\nWorkspace catalog rendering\n${workspaceCatalogDiagnostics.report()}`;
}
