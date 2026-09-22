import type { WindowDiagnosticsPort } from "./windowDiagnosticsContract";

/** Window geometry instrumentation is available only in a supporting Android binary. */
export function windowDiagnosticsPort(): WindowDiagnosticsPort {
  return { status: "unavailable" };
}
