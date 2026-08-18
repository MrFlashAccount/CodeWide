import { describe, expect, it } from "vitest";

import { RealtimeAudioUploader, type RealtimeAudioChunk } from "../src/data/realtime-audio-uploader";

const chunk = (index: number): RealtimeAudioChunk => ({
  data: `chunk-${index}`,
  sampleRate: 24_000,
  numChannels: 1,
  samplesPerChannel: 2_400,
});

describe("RealtimeAudioUploader", () => {
  it("drains a slow remote link in order without silently dropping chunks", async () => {
    const sent: RealtimeAudioChunk[][] = [];
    const pending: Array<{ settled: boolean; resolve(): void }> = [];
    const errors: string[] = [];
    let concurrent = 0;
    let maximumConcurrent = 0;
    const uploader = new RealtimeAudioUploader({
      batchDurationMs: 300,
      onError: (message) => errors.push(message),
      send: async (_batchId, audio) => {
        sent.push(audio);
        concurrent += 1;
        maximumConcurrent = Math.max(maximumConcurrent, concurrent);
        await new Promise<void>((resolve) => pending.push({ settled: false, resolve }));
        concurrent -= 1;
      },
    });

    for (let index = 0; index < 5; index += 1) uploader.append(chunk(index));
    expect(sent.map((batch) => batch.map(({ data }) => data))).toEqual([["chunk-0", "chunk-1", "chunk-2"]]);
    const finishing = uploader.finish();

    for (let guard = 0; guard < 20 && sent.length < 2; guard += 1) {
      for (const request of pending) {
        if (request.settled) continue;
        request.settled = true;
        request.resolve();
      }
      await Promise.resolve();
      await Promise.resolve();
    }
    for (const request of pending) {
      if (!request.settled) request.resolve();
    }
    await finishing;

    expect(errors).toEqual([]);
    const flattened = sent.flat();
    expect(flattened.slice(0, 5).map(({ data }) => data)).toEqual([
      "chunk-0",
      "chunk-1",
      "chunk-2",
      "chunk-3",
      "chunk-4",
    ]);
    expect(flattened).toHaveLength(5);
    expect(maximumConcurrent).toBe(1);
  });

  it("keeps more than five seconds of weak-network backlog and drains it without loss", async () => {
    const sent: string[] = [];
    const batchIds: number[] = [];
    const errors: string[] = [];
    const uploader = new RealtimeAudioUploader({
      batchDurationMs: 100,
      onError: (message) => errors.push(message),
      send: async (batchId, audio) => {
        batchIds.push(batchId);
        sent.push(...audio.map(({ data }) => data));
        await Promise.resolve();
      },
    });

    for (let index = 0; index < 70; index += 1) uploader.append(chunk(index));
    await uploader.finish();

    expect(errors).toEqual([]);
    expect(sent).toEqual(Array.from({ length: 70 }, (_, index) => `chunk-${index}`));
    expect(batchIds).toEqual(Array.from({ length: 70 }, (_, index) => index));
  });

  it("rejects malformed native audio at the boundary", async () => {
    const errors: string[] = [];
    const uploader = new RealtimeAudioUploader({
      onError: (message) => errors.push(message),
      send: async () => undefined,
    });

    uploader.append({ ...chunk(0), sampleRate: 0 });
    uploader.append(chunk(1));
    await uploader.cancel();

    expect(errors).toEqual(["Invalid microphone audio chunk"]);
  });

  it("flushes a partial batch without synthesizing audio and rejects mid-stream format changes", async () => {
    const sent: RealtimeAudioChunk[][] = [];
    const errors: string[] = [];
    const uploader = new RealtimeAudioUploader({
      onError: (message) => errors.push(message),
      send: async (_batchId, audio) => { sent.push(audio); },
    });

    uploader.append({ ...chunk(0), sampleRate: 48_000, samplesPerChannel: 4_800 });
    await uploader.finish();

    expect(errors).toEqual([]);
    expect(sent.flat()).toEqual([{ ...chunk(0), sampleRate: 48_000, samplesPerChannel: 4_800 }]);

    const changedErrors: string[] = [];
    const changed = new RealtimeAudioUploader({
      onError: (message) => changedErrors.push(message),
      send: async () => undefined,
    });
    changed.append(chunk(0));
    changed.append({ ...chunk(1), sampleRate: 48_000, samplesPerChannel: 4_800 });
    await changed.cancel();
    expect(changedErrors).toEqual(["Microphone audio format changed during recording"]);
  });
});
