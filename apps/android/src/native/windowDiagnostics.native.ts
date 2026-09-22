import { NativeModules } from "react-native";

import type { WindowDiagnosticsPort } from "./windowDiagnosticsContract";

function recordingValue(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("Invalid window diagnostics state");
  }
  return value;
}

const MAX_REPORT_LENGTH = 1_000_000;

function isModule(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReader(value: unknown): value is () => unknown {
  return typeof value === "function";
}

function isWriter(value: unknown): value is (enabled: boolean) => unknown {
  return typeof value === "function";
}

/** Validate optional bridge capabilities and results before exposing the project contract. */
export function windowDiagnosticsPort(): WindowDiagnosticsPort {
  const candidate: unknown = NativeModules.CodeWideWindowDiagnostics;
  if (
    !isModule(candidate) ||
    !isReader(candidate.getRecording) ||
    !isWriter(candidate.setRecording) ||
    !isReader(candidate.captureReport)
  ) {
    return { status: "unavailable" };
  }
  const { captureReport, getRecording, setRecording } = candidate;
  return {
    captureReport: async () => {
      const result: unknown = await captureReport();
      // The report is an opaque native-owned export, never application state or executable input.
      if (typeof result !== "string" || result.length === 0 || result.length > MAX_REPORT_LENGTH) {
        throw new Error("Invalid window diagnostics report");
      }
      return result;
    },
    getRecording: async () => {
      const result: unknown = await getRecording();
      return recordingValue(result);
    },
    setRecording: async (enabled) => {
      const result: unknown = await setRecording(enabled);
      return recordingValue(result);
    },
    status: "available",
  };
}
