/**
 * Claude subscription limits: `rate_limit_event` and usage-read mapping, the
 * merged snapshot, session reporting and the `rateLimits.updated`
 * notification.
 */

import { describe, expect, it } from "vitest";
import { USAGE_READ_INTERVAL_MS } from "../src/account/rateLimitReporter.js";
import { classifyFrame } from "../src/mapping/frames.js";
import {
  RateLimitBook,
  rateLimitEventWindow,
  usageReadWindows,
} from "../src/mapping/rateLimits.js";
import { RpcServer } from "../src/rpc/server.js";
import { createMemoryLogger } from "../src/log.js";
import {
  createThread,
  frames,
  harness,
  prompt,
  scriptedRuntime,
  settle,
  startedTurn,
  THREAD,
} from "./support/scripted.js";

const RESET = 1_760_010_000;

const rateLimitEvent = (info: unknown) => ({
  type: "rate_limit_event",
  rate_limit_info: info,
  uuid: "00000000-0000-4000-8000-000000000001",
  session_id: THREAD,
});

const usageRead = {
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 12.4, resets_at: "2025-10-09T12:00:00Z" },
    seven_day: { utilization: 61, resets_at: null },
    seven_day_opus: null,
  },
};

describe("rate_limit_event mapping", () => {
  it("maps a window's fraction, reset and status", () => {
    expect(
      rateLimitEventWindow({
        status: "allowed_warning",
        rateLimitType: "seven_day",
        utilization: 0.834,
        resetsAt: RESET,
      }),
    ).toEqual({
      id: "seven_day",
      kind: "weekly",
      label: "Weekly",
      resetsAt: RESET,
      status: "warning",
      usedPercent: 83,
      windowDurationMins: 10_080,
    });
  });

  it("keeps an unknown window as `other` and clamps the percentage", () => {
    expect(
      rateLimitEventWindow({ status: "rejected", rateLimitType: "monthly_x", utilization: 1.7 }),
    ).toEqual({
      id: "monthly_x",
      kind: "other",
      label: "monthly_x",
      resetsAt: null,
      status: "rejected",
      usedPercent: 100,
      windowDurationMins: null,
    });
  });

  it("ignores events without a usable window", () => {
    expect(rateLimitEventWindow({ status: "allowed" })).toBeNull();
    expect(rateLimitEventWindow({ rateLimitType: "five_hour" })).toBeNull();
    expect(rateLimitEventWindow({ rateLimitType: "Five Hour!", utilization: 0.1 })).toBeNull();
    expect(rateLimitEventWindow(null)).toBeNull();
    expect(classifyFrame(rateLimitEvent({ status: "allowed" }))).toEqual({
      kind: "rateLimit",
      status: "allowed",
      window: null,
    });
  });
});

describe("usage read mapping", () => {
  it("maps 0–100 utilization and ISO reset times of the known windows", () => {
    expect(usageReadWindows(usageRead)).toEqual([
      {
        id: "five_hour",
        kind: "session",
        label: "Session",
        resetsAt: Date.parse("2025-10-09T12:00:00Z") / 1000,
        status: null,
        usedPercent: 12,
        windowDurationMins: 300,
      },
      {
        id: "seven_day",
        kind: "weekly",
        label: "Weekly",
        resetsAt: null,
        status: null,
        usedPercent: 61,
        windowDurationMins: 10_080,
      },
    ]);
  });

  it("reads nothing where plan limits do not apply or the shape is unknown", () => {
    expect(usageReadWindows({ rate_limits_available: false, rate_limits: null })).toEqual([]);
    expect(usageReadWindows({ rate_limits_available: true, rate_limits: "x" })).toEqual([]);
    expect(usageReadWindows(null)).toEqual([]);
  });
});

describe("RateLimitBook", () => {
  const window = (id: string, usedPercent: number | null, resetsAt: number | null = RESET) =>
    rateLimitEventWindow({
      rateLimitType: id,
      status: "allowed",
      ...(usedPercent === null ? {} : { utilization: usedPercent / 100 }),
      ...(resetsAt === null ? {} : { resetsAt }),
    });

  it("merges by id, orders session before weekly before others and skips no-op updates", () => {
    const book = new RateLimitBook();
    const overage = rateLimitEventWindow({ rateLimitType: "overage", status: "rejected" });
    const weekly = window("seven_day", 40);
    const session = window("five_hour", 10);
    if (overage === null || weekly === null || session === null) throw new Error("windows");
    expect(book.apply([overage, weekly], 100)?.windows.map((entry) => entry.id)).toEqual([
      "seven_day",
      "overage",
    ]);
    const next = book.apply([session], 101);
    expect(next?.updatedAt).toBe(101);
    expect(next?.windows.map((entry) => entry.id)).toEqual(["five_hour", "seven_day", "overage"]);
    expect(book.apply([session], 102)).toBeNull();
    expect(book.snapshot()?.updatedAt).toBe(101);
  });

  it("keeps a known percentage when a later report carries only a status, until a reset", () => {
    const book = new RateLimitBook();
    const first = window("five_hour", 30);
    const statusOnly = window("five_hour", null);
    const afterReset = window("five_hour", null, RESET + 18_000);
    if (first === null || statusOnly === null || afterReset === null) throw new Error("windows");
    book.apply([first], 1);
    expect(book.apply([statusOnly], 2)).toBeNull();
    expect(book.apply([afterReset], 3)?.windows[0]?.usedPercent).toBeNull();
  });
});

describe("sessions report limits", () => {
  it("publishes a streamed window and reads usage through the live query at most once per interval", async () => {
    const { service, queries, publishedLimits, clock } = harness();
    createThread(service);
    startedTurn(await service.startTurn(THREAD, prompt("first")));
    const query = queries[0];
    if (query === undefined) throw new Error("query");
    query.usage = usageRead;
    query.push(frames.init);
    query.push(rateLimitEvent({ status: "allowed", rateLimitType: "five_hour", utilization: 0.5 }));
    query.push(rateLimitEvent({ status: "allowed" }));
    query.push(frames.result());
    await settle();
    expect(query.usageReads).toBe(1);
    expect(
      publishedLimits.map((limits) => limits.windows.map((entry) => entry.usedPercent)),
    ).toEqual([[50], [12, 61]]);

    startedTurn(await service.startTurn(THREAD, prompt("second")));
    query.push(frames.result());
    await settle();
    expect(query.usageReads).toBe(1);

    clock.now += USAGE_READ_INTERVAL_MS;
    startedTurn(await service.startTurn(THREAD, prompt("third")));
    query.push(frames.result());
    await settle();
    expect(query.usageReads).toBe(2);
    // The same figures publish nothing new.
    expect(publishedLimits).toHaveLength(2);
  });
});

describe("rateLimits.updated", () => {
  it("is sent after initialized: the earlier snapshot first, then each change", async () => {
    const lines: unknown[] = [];
    const { service, rateLimits } = harness();
    const { runtime } = scriptedRuntime();
    const rpc = new RpcServer({
      logger: createMemoryLogger(),
      rateLimits,
      runtime: {
        ...runtime,
        probe: () =>
          Promise.resolve({
            account: { authenticated: true, label: "max" },
            models: [],
            usage: usageRead,
          }),
      },
      service,
      version: "0.1.0",
      write: (line) => lines.push(JSON.parse(line)),
    });
    const updates = () =>
      lines.filter(
        (line) => (line as { readonly method?: unknown }).method === "rateLimits.updated",
      );
    await rpc.handleLine(
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: {
          protocol: "codewide-agent",
          protocolVersion: 1,
          client: { name: "t", version: "0" },
        },
      }),
    );
    expect(updates()).toEqual([]);
    await rpc.handleLine(JSON.stringify({ method: "initialized" }));
    expect(updates()).toEqual([
      { method: "rateLimits.updated", params: { rateLimits: rateLimits.snapshot() } },
    ]);
    const session = rateLimitEventWindow({ rateLimitType: "five_hour", utilization: 0.9 });
    if (session === null) throw new Error("window");
    const next = new RateLimitBook().apply([session], 1);
    if (next === null) throw new Error("snapshot");
    rpc.publishRateLimits(next);
    expect(updates()).toHaveLength(2);
    expect(updates().at(-1)).toEqual({
      method: "rateLimits.updated",
      params: { rateLimits: next },
    });
  });
});
