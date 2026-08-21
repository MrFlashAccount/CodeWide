import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureTelemetryTransport,
  flushTelemetry,
  recordTelemetryEvent,
  resetTelemetryForTests,
  setTelemetryEnabled,
  type TelemetryBatch,
} from "../src/data/telemetry";

describe("telemetry batching", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetTelemetryForTests();
  });

  it("can be disabled and sends structured batches without content", async () => {
    const batches: TelemetryBatch[] = [];
    configureTelemetryTransport(async (_connectionId, batch) => { batches.push(batch); });
    setTelemetryEnabled(false);
    recordTelemetryEvent("server", { name: "stream.react_commit", tags: { content: "must-not-be-a-field" } });
    await flushTelemetry();
    expect(batches).toEqual([]);

    setTelemetryEnabled(true);
    recordTelemetryEvent("server", {
      name: "stream.react_commit",
      requestId: "request-1",
      values: { latencyMs: 12 },
      tags: { source: "react" },
    });
    await flushTelemetry();

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      version: 1,
      events: [{ name: "stream.react_commit", connectionId: "server", requestId: "request-1", values: { latencyMs: 12 } }],
    });
    expect(JSON.stringify(batches[0])).not.toContain('"content"');
  });

  it("retries a failed batch without losing events", async () => {
    let attempts = 0;
    const delivered: TelemetryBatch[] = [];
    configureTelemetryTransport(async (_connectionId, batch) => {
      attempts += 1;
      if (attempts === 1) throw new Error("offline");
      delivered.push(batch);
    });
    setTelemetryEnabled(true);
    recordTelemetryEvent("server", { name: "sync.rpc", requestId: "request-1" });

    await flushTelemetry();
    expect(delivered).toEqual([]);
    await flushTelemetry();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.events[0]?.requestId).toBe("request-1");
  });

  it("flushes no more than 64 events per batch", async () => {
    vi.useFakeTimers();
    const batches: TelemetryBatch[] = [];
    configureTelemetryTransport(async (_connectionId, batch) => { batches.push(batch); });
    setTelemetryEnabled(true);
    for (let index = 0; index < 70; index += 1) {
      recordTelemetryEvent("server", { name: "stream.delta", values: { index } });
    }
    await flushTelemetry();
    await flushTelemetry();
    expect(batches.map((batch) => batch.events.length)).toEqual([64, 6]);
  });
});
