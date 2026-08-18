import { describe, expect, it } from "vitest";

import { renderRecoveryPrompt } from "../src/ui/render-recovery-prompt";

describe("render recovery prompt", () => {
  it("keeps the failing surface and actionable stacks", () => {
    const error = new Error("Cannot read property layout of null");
    error.stack = "WaveText at render";
    const prompt = renderRecoveryPrompt({
      scope: "bubble",
      label: "Agent message",
      error,
      componentStack: "at WaveText\nat ProtocolBlock",
      context: "Thread: thread-1\nTurn: turn-2",
    });

    expect(prompt).toContain("Surface: bubble / Agent message");
    expect(prompt).toContain("Thread: thread-1");
    expect(prompt).toContain("Cannot read property layout of null");
    expect(prompt).toContain("at ProtocolBlock");
    expect(prompt).toContain("add a regression test");
  });

  it("bounds crash reports before attaching them to a repair chat", () => {
    const error = new Error("large crash");
    error.stack = "s".repeat(20_000);
    const prompt = renderRecoveryPrompt({
      scope: "dialog",
      label: "Image preview",
      error,
      componentStack: "c".repeat(20_000),
      context: "x".repeat(10_000),
    });

    expect(prompt.length).toBeLessThan(20_000);
    expect(prompt.match(/…truncated/gu)?.length).toBe(3);
  });
});
