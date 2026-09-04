import { describe, expect, it } from "vitest";

import { connectionDiagnosticReport } from "../src/data/connection-diagnostic-report";
import { nativeEngineErrorDiagnostic } from "../src/native/native-engine-error-diagnostic";

describe("native engine error diagnostics", () => {
  it("does not replace an Error with a missing message by a secondary length failure", () => {
    const malformed = new Error("discarded");
    Object.defineProperty(malformed, "message", { value: undefined });
    Object.defineProperty(malformed, "stack", { value: "TypeError\n    at applyProjection" });

    expect(nativeEngineErrorDiagnostic(malformed, "Native projection update failed")).toBe([
      "Native projection update failed",
      "",
      "JavaScript stack:",
      "TypeError\n    at applyProjection",
    ].join("\n"));
  });

  it("preserves the original message and JavaScript stack", () => {
    const error = new TypeError("turn items are missing");
    error.stack = "TypeError: turn items are missing\n    at projectTurn";

    expect(nativeEngineErrorDiagnostic(error, "Projection failed")).toContain(
      "TypeError: turn items are missing\n\nJavaScript stack:\nTypeError: turn items are missing\n    at projectTurn",
    );
  });

  it("copies a credential-free V1 connection report with runtime context", () => {
    const report = connectionDiagnosticReport({
      appVersion: "0.2.3",
      connectionId: "server-opaque-id",
      enabled: true,
      error: "TypeError: broken\n\nJavaScript stack:\nat projection",
      occurredAt: Date.UTC(2026, 8, 4, 10, 20, 30),
      platform: "android",
      platformVersion: 36,
      state: "degraded",
    });

    expect(report).toContain("CodeWide V1 connection failure");
    expect(report).toContain("Connection ID: server-opaque-id");
    expect(report).toContain("Occurred at: 2026-09-04T10:20:30.000Z");
    expect(report).toContain("Platform: android 36");
    expect(report).toContain("JavaScript stack:\nat projection");
    expect(report).not.toContain("endpoint");
    expect(report).not.toContain("token");
  });
});
