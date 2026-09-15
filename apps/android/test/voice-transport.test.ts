import type { RpcClient } from "@codewide/sync-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceTransport } from "../src/data/voice-transport";
import type { VoiceTranscriptionEvent } from "../src/data/voice-input-controller";

const session: RpcClient = {
  rpc: async () => {
    throw new Error("transport must use the authenticated RPC capability");
  },
};

function transport(respond: (method: string, params: unknown) => Promise<unknown>) {
  return createVoiceTransport({
    getEnabledSession: (id) => (id === "enabled" ? session : undefined),
    rpcAfterAttach: async (_session, method, params) => await respond(method, params),
  });
}

afterEach(() => vi.useRealTimers());

describe("V1 voice transport", () => {
  it("rejects unavailable authority before opening a dictation session", async () => {
    let calls = 0;
    const start = transport(async () => {
      calls += 1;
      return {};
    });
    await expect(start("disabled", "thread", () => undefined)).rejects.toThrow(
      "Connection is not enabled",
    );
    expect(calls).toBe(0);
  });

  it("drains accepted audio before one shared finish and publishes the final transcript once", async () => {
    const batch = Promise.withResolvers<unknown>();
    const finish = Promise.withResolvers<unknown>();
    const methods: string[] = [];
    const events: VoiceTranscriptionEvent[] = [];
    const start = transport(async (method) => {
      methods.push(method);
      if (method.endsWith("/start")) return { sessionId: "dictation" };
      if (method.endsWith("/appendBatch")) return await batch.promise;
      return await finish.promise;
    });
    const active = await start("enabled", "thread", (event) => events.push(event));
    active.appendAudio({ data: "pcm", sampleRate: 24_000, numChannels: 1, samplesPerChannel: 240 });
    const first = active.finish();
    const second = active.finish();
    expect(methods).toEqual(["companion/dictation/start", "companion/dictation/appendBatch"]);
    batch.resolve({ accepted: true });
    await vi.waitFor(() => expect(methods).toContain("companion/dictation/finish"));
    finish.resolve({ text: "final transcript" });
    await Promise.all([first, second]);
    expect(methods.filter((method) => method.endsWith("/finish"))).toHaveLength(1);
    expect(events).toEqual([{ type: "done", text: "final transcript" }]);
  });

  it("retries a transport failure with the same audio batch before finishing", async () => {
    vi.useFakeTimers();
    const batches: unknown[] = [];
    const start = transport(async (method, params) => {
      if (method.endsWith("/start")) return { sessionId: "dictation" };
      if (method.endsWith("/appendBatch")) {
        batches.push(params);
        if (batches.length === 1) throw new Error("connection interrupted");
        return { accepted: true };
      }
      return { text: "retried transcript" };
    });
    const active = await start("enabled", "thread", () => undefined);
    active.appendAudio({ data: "pcm", sampleRate: 24_000, numChannels: 1, samplesPerChannel: 240 });
    const finishing = active.finish();
    await vi.runAllTimersAsync();
    await finishing;
    expect(batches).toHaveLength(2);
    expect(batches[1]).toBe(batches[0]);
  });

  it("cancels pending finish without publishing a later transcript", async () => {
    const finish = Promise.withResolvers<unknown>();
    const methods: string[] = [];
    const events: VoiceTranscriptionEvent[] = [];
    const start = transport(async (method) => {
      methods.push(method);
      if (method.endsWith("/start")) return { sessionId: "dictation" };
      if (method.endsWith("/finish")) return await finish.promise;
      return {};
    });
    const active = await start("enabled", "thread", (event) => events.push(event));
    const finishing = active.finish();
    const rejected = expect(finishing).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(methods).toContain("companion/dictation/finish"));
    await active.cancel();
    await rejected;
    finish.resolve({ text: "stale transcript" });
    await Promise.resolve();
    expect(events).toEqual([]);
    expect(methods.filter((method) => method.endsWith("/cancel"))).toHaveLength(1);
  });
});
