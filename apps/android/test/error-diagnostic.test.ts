import { describe, expect, it } from "vitest";
import { errorDiagnostic } from "../src/ui/error-diagnostic";

describe("explicit local error reports", () => {
  it("preserves original messages, JS stacks, native code/frames and nested causes", () => {
    const native = new Error("write failed: EBADF (Bad file descriptor)");
    const failure = new Error("Unable to save", { cause: native });
    Object.assign(failure, {
      code: "ERR_FILESYSTEM_WRITE",
      nativeStackAndroid: [{ class: "FileOutputStream", methodName: "write", file: "FileOutputStream.java", lineNumber: 42 }],
      payload: "must not serialize arbitrary payloads",
    });
    const report = errorDiagnostic("Download failed", failure);
    expect(report).toContain("Download failed");
    expect(report).toContain(failure.message);
    expect(report).toContain(failure.stack);
    expect(report).toContain(native.message);
    expect(report).toContain(native.stack);
    expect(report).toContain("ERR_FILESYSTEM_WRITE");
    expect(report).toContain("methodName=write");
    expect(report).toContain("file=FileOutputStream.java");
    expect(report).toContain("lineNumber=42");
    expect(report).not.toContain("must not serialize arbitrary payloads");
  });

  it("survives cyclic causes and native error properties that throw", () => {
    const failure = new Error("Original error");
    Object.defineProperty(failure, "nativeStackAndroid", { get() { throw new Error("Getter failed"); } });
    Object.defineProperty(failure, "cause", { value: failure });
    const report = errorDiagnostic("Download failed", failure);
    expect(report).toContain("Original error");
    expect(report).toContain("[Circular cause]");
    expect(report).not.toContain("Getter failed");
  });

  it("accepts native plain-object failures and explicitly marks truncation", () => {
    expect(errorDiagnostic("Save", { message: "EBADF", code: 9 })).toContain("code: 9");
    const report = errorDiagnostic("Save", new Error("x".repeat(100_000)));
    expect(report.length).toBeLessThan(65_000);
    expect(report).toContain("[Report truncated]");
    expect(errorDiagnostic("Save", "Provider failed")).toContain("Provider failed");
    expect(errorDiagnostic("Save", undefined)).toContain("No error details available");
  });
});
