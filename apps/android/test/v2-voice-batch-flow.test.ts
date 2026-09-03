import { describe, expect, it } from "vitest";

import { VoiceBatchFlow } from "../src/v2/infrastructure/voice/voiceBatchFlow";

function batch(sequence: string) {
  return {
    data: `audio-${sequence}`,
    numChannels: 1,
    sampleRate: 48_000,
    samplesPerChannel: 4_800,
    sequence,
    sessionId: "voice-session",
    type: "batch" as const,
  };
}

describe("V2 Voice batch flow", () => {
  it("keeps exactly one batch unacknowledged and drains in capture order", () => {
    const sent: string[] = [];
    const flow = new VoiceBatchFlow({
      sendBatch: (record) => sent.push(record.sequence),
      sendFinish: () => sent.push("finish"),
    });

    flow.append(batch("0"));
    flow.append(batch("1"));
    flow.append(batch("2"));
    expect(sent).toEqual(["0"]);

    expect(flow.acknowledge("voice-session", "0")).toBe(true);
    expect(sent).toEqual(["0", "1"]);
    expect(flow.acknowledge("voice-session", "1")).toBe(true);
    expect(sent).toEqual(["0", "1", "2"]);
  });

  it("waits for the final acknowledgement before sending finish", async () => {
    const sent: string[] = [];
    const flow = new VoiceBatchFlow({
      sendBatch: (record) => sent.push(record.sequence),
      sendFinish: () => sent.push("finish"),
    });
    flow.append(batch("0"));
    flow.append(batch("1"));

    const finishing = flow.finish();
    expect(sent).toEqual(["0"]);
    flow.acknowledge("voice-session", "0");
    expect(sent).toEqual(["0", "1"]);
    flow.acknowledge("voice-session", "1");
    await finishing;
    expect(sent).toEqual(["0", "1", "finish"]);
  });

  it("rejects unrelated acknowledgements and permits an explicit finish retry", async () => {
    const sent: string[] = [];
    const flow = new VoiceBatchFlow({
      sendBatch: (record) => sent.push(record.sequence),
      sendFinish: () => sent.push("finish"),
    });
    flow.append(batch("0"));
    expect(flow.acknowledge("another-session", "0")).toBe(false);
    expect(flow.acknowledge("voice-session", "1")).toBe(false);
    expect(flow.acknowledge("voice-session", "0")).toBe(true);

    const firstFinish = flow.finish();
    expect(firstFinish).toBeInstanceOf(Promise);
    await firstFinish;
    flow.allowFinishRetry();
    await flow.finish();
    expect(sent).toEqual(["0", "finish", "finish"]);
  });

  it("fails explicitly instead of retaining unbounded audio while acknowledgements stall", () => {
    const flow = new VoiceBatchFlow({
      sendBatch: () => undefined,
      sendFinish: () => undefined,
    });
    // WHY: Four maximum-size decoded batches are the bounded transport buffer; the fifth must never enter the JS queue.
    const maximumBatch = "A".repeat(1_398_102) + "==";

    for (let sequence = 0; sequence < 4; sequence += 1) {
      flow.append({ ...batch(String(sequence)), data: maximumBatch });
    }

    expect(() => flow.append({ ...batch("4"), data: maximumBatch })).toThrow(
      "Voice audio buffer capacity exceeded",
    );
  });
});
