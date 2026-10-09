import { NativeModules } from "react-native";
import { diagnosticLogJson, type DiagnosticLogInput } from "./diagnosticReport";

/** Commits before returning so a following fatal exception cannot discard the JS queue. */
export function persistDiagnosticLog(record: DiagnosticLogInput): void {
  const bridge: unknown = NativeModules.CodeWideNative;
  if (
    typeof bridge !== "object" ||
    bridge === null ||
    !("persistDiagnosticReport" in bridge) ||
    typeof bridge.persistDiagnosticReport !== "function"
  ) {
    return;
  }
  // The native owner validates, redacts and atomically persists before resolving this synchronous call.
  Reflect.apply(bridge.persistDiagnosticReport, bridge, [diagnosticLogJson(record)]);
}
