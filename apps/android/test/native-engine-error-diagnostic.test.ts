import { describe, expect, it } from "vitest";

import { connectionDiagnosticReport } from "../src/features/connections/connectionDiagnosticReport";
import { nativeEngineErrorDiagnostic } from "../src/native/native-engine-error-diagnostic";

describe("native engine error diagnostics", () => {
  it("does not replace an Error with a missing message by a secondary length failure", () => {
    const malformed = new Error("discarded");
    Object.defineProperty(malformed, "message", { value: undefined });
    Object.defineProperty(malformed, "stack", { value: "TypeError\n    at parseNativeState" });

    expect(nativeEngineErrorDiagnostic(malformed, "Native engine state is invalid")).toBe(
      [
        "Native engine state is invalid",
        "",
        "JavaScript stack:",
        "TypeError\n    at parseNativeState",
      ].join("\n"),
    );
  });

  it("preserves the original message and JavaScript stack", () => {
    const error = new TypeError("RPC availability is missing");
    error.stack = "TypeError: RPC availability is missing\n    at parseNativeState";

    expect(nativeEngineErrorDiagnostic(error, "Native engine state is invalid")).toContain(
      "TypeError: RPC availability is missing\n\nJavaScript stack:\nTypeError: RPC availability is missing\n    at parseNativeState",
    );
  });

  it("copies a credential-free V1 connection report with runtime context", () => {
    const report = connectionDiagnosticReport({
      appVersion: "0.2.3",
      connectionId: "server-opaque-id",
      enabled: true,
      error: "TypeError: invalid native state\n\nJavaScript stack:\nat parseNativeState",
      occurredAt: Date.UTC(2026, 8, 4, 10, 20, 30),
      platform: "android",
      platformVersion: 36,
      state: "degraded",
    });

    expect(report).toContain("CodeWide V1 connection failure");
    expect(report).toContain("Connection ID: server-opaque-id");
    expect(report).toContain("Occurred at: 2026-09-04T10:20:30.000Z");
    expect(report).toContain("Platform: android 36");
    expect(report).toContain("JavaScript stack:\nat parseNativeState");
    expect(report).not.toContain("endpoint");
    expect(report).not.toContain("token");
  });
});
