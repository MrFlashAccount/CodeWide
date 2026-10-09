import { describe, expect, it } from "vitest";
import { diagnosticLogJson } from "../src/observability/diagnosticReport";

describe("complete diagnostic error serialization", () => {
  it("keeps the original message, stack, every nested Error and all native frames", () => {
    const message = "diagnostic λ ".repeat(100_000);
    let failure = new Error("deepest cause");
    const deepest = failure;
    for (let index = 0; index < 20; index += 1) failure = new Error(`cause ${index}`, { cause: failure });
    const root = new Error(message, { cause: failure });
    Object.assign(root, {
      nativeStackAndroid: Array.from({ length: 300 }, (_, index) => ({
        class: "RenderOwner", methodName: `frame${index}`, file: "RenderOwner.java", lineNumber: index,
        payload: "private content must not serialize",
      })),
    });
    const serialized = JSON.parse(diagnosticLogJson({
      err: root, event: "render.root.failed", fields: { requestId: "request-opaque" }, level: "fatal", occurredAtUnixMs: 42,
    }));
    expect(serialized.err.message).toBe(message);
    expect(serialized.err.stack).toBe(root.stack);
    expect(serialized.err.causes.at(-1).stack).toBe(deepest.stack);
    expect(serialized.err.causes).toHaveLength(21);
    expect(serialized.err.nativeStack).toContain("methodName=frame299");
    expect(serialized.err.nativeStack).not.toContain("private content");
    expect(serialized.fields.requestId).toBe("request-opaque");
  });

  it("terminates circular cause chains and survives a native frame getter failure", () => {
    const failure = new Error("original failure");
    Object.defineProperty(failure, "cause", { value: failure });
    Object.defineProperty(failure, "nativeStackAndroid", { get() { throw new Error("untrusted getter"); } });
    const serialized = JSON.parse(diagnosticLogJson({
      err: failure, event: "render.root.failed", fields: {}, level: "error", occurredAtUnixMs: 73,
    }));
    expect(serialized.err.stack).toBe(failure.stack);
    expect(serialized.err.causes).toEqual([]);
    expect(serialized.err.nativeStack).toBe("");
  });
});
