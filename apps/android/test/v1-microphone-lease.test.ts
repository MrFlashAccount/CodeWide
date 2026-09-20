import { describe, expect, it, vi } from "vitest";

import { createV1MicrophoneLeaseRegistry } from "../src/data/v1MicrophoneLease";

describe("V1MicrophoneLeaseRegistry", () => {
  it("does not let Global Voice preempt ordinary dictation", async () => {
    let sequence = 0;
    const registry = createV1MicrophoneLeaseRegistry(() => `lease-${String(++sequence)}`);
    const dictation = await registry.acquireDictation("composer");
    expect(dictation.status).toBe("acquired");
    expect(registry.acquireGlobalSupervisor("activation")).toEqual({
      owner: { kind: "dictation", scope: "composer" },
      status: "busy",
    });
  });

  it("hands capture to dictation and back without releasing the logical assistant", async () => {
    let sequence = 0;
    const registry = createV1MicrophoneLeaseRegistry(() => `lease-${String(++sequence)}`);
    const paused = Promise.withResolvers<void>();
    const resumed = Promise.withResolvers<void>();
    const assistant = registry.acquireGlobalSupervisor("activation", {
      pauseForDictation: vi.fn(() => paused.promise),
      resumeAfterDictation: vi.fn(() => resumed.promise),
    });
    if (assistant.status !== "acquired") throw new Error("Expected assistant lease");

    const acquiring = registry.acquireDictation("review-input");
    expect(registry.state()).toEqual({
      assistant: { activationId: "activation", kind: "globalSupervisor" },
      dictation: { kind: "dictation", scope: "review-input" },
      phase: "handoffToDictation",
    });
    paused.resolve();
    const dictation = await acquiring;
    if (dictation.status !== "acquired") throw new Error("Expected dictation lease");
    expect(registry.state()).toEqual({
      assistant: { activationId: "activation", kind: "globalSupervisor" },
      dictation: { kind: "dictation", scope: "review-input" },
      phase: "dictationOwned",
    });

    const releasing = dictation.lease.release();
    expect(registry.state()).toEqual({
      assistant: { activationId: "activation", kind: "globalSupervisor" },
      dictation: { kind: "dictation", scope: "review-input" },
      phase: "handoffBack",
    });
    resumed.resolve();
    await releasing;
    expect(registry.state()).toEqual({
      assistant: { activationId: "activation", kind: "globalSupervisor" },
      phase: "assistantOwned",
    });
    expect(registry.currentOwner()).toEqual({
      activationId: "activation",
      kind: "globalSupervisor",
    });
  });

  it("deduplicates a repeated tap during handoff and never grants two captures", async () => {
    const registry = createV1MicrophoneLeaseRegistry(() => "token");
    const paused = Promise.withResolvers<void>();
    const pauseForDictation = vi.fn(() => paused.promise);
    registry.acquireGlobalSupervisor("activation", {
      pauseForDictation,
      resumeAfterDictation: vi.fn(async () => undefined),
    });

    const first = registry.acquireDictation("composer");
    const repeated = registry.acquireDictation("composer");
    const competing = await registry.acquireDictation("review");
    expect(competing).toEqual({
      owner: { kind: "dictation", scope: "composer" },
      status: "busy",
    });
    expect(pauseForDictation).toHaveBeenCalledOnce();
    paused.resolve();
    const [firstResult, repeatedResult] = await Promise.all([first, repeated]);
    expect(firstResult.status).toBe("acquired");
    expect(repeatedResult).toBe(firstResult);
  });

  it("lets explicit Stop win during dictation without resuming the assistant", async () => {
    const registry = createV1MicrophoneLeaseRegistry(() => "token");
    const resumeAfterDictation = vi.fn(async () => undefined);
    const assistant = registry.acquireGlobalSupervisor("activation", {
      pauseForDictation: vi.fn(async () => undefined),
      resumeAfterDictation,
    });
    if (assistant.status !== "acquired") throw new Error("Expected assistant lease");
    const dictation = await registry.acquireDictation("composer");
    if (dictation.status !== "acquired") throw new Error("Expected dictation lease");

    expect(await assistant.lease.release()).toBe(true);
    expect(registry.state()).toEqual({
      assistant: null,
      dictation: { kind: "dictation", scope: "composer" },
      phase: "dictationOwned",
    });
    expect(await dictation.lease.release()).toBe(true);
    expect(resumeAfterDictation).not.toHaveBeenCalled();
    expect(registry.state()).toEqual({ phase: "idle" });
  });

  it("requires the live token to release a newer owner", async () => {
    let sequence = 0;
    const registry = createV1MicrophoneLeaseRegistry(() => `lease-${String(++sequence)}`);
    const first = await registry.acquireDictation("composer");
    if (first.status !== "acquired") throw new Error("Expected first lease");
    expect(await first.lease.release()).toBe(true);
    const second = registry.acquireGlobalSupervisor("activation");
    if (second.status !== "acquired") throw new Error("Expected second lease");
    expect(await first.lease.release()).toBe(false);
    expect(registry.currentOwner()).toEqual({
      activationId: "activation",
      kind: "globalSupervisor",
    });
    expect(await second.lease.release()).toBe(true);
    expect(registry.currentOwner()).toBeNull();
  });
});
