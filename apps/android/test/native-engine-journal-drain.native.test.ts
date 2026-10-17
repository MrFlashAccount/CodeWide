import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncEvent } from "@codewide/sync-client";

const native = vi.hoisted(() => ({
  acknowledgeProjection: vi.fn(),
  attachSocket: vi.fn(async () => undefined),
  engineRpc: vi.fn(),
  readCommittedFrames: vi.fn(),
}));

// WHY: React Native's native module registry cannot run in Node. Only the
// platform boundary is replaced; the real session and projection queues run.
vi.mock("react-native", () => ({
  NativeEventEmitter: class {
    addListener() {
      return { remove() {} };
    }
  },
  NativeModules: { CodeWideNative: native },
  PermissionsAndroid: {},
  Platform: { OS: "android" },
}));

import { NativeEngineSession } from "../src/native/native-engine.native";

const sessions: NativeEngineSession[] = [];
const settle = async () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function committed(cursor: number) {
  return {
    cursor,
    payload: JSON.stringify({ cursor, payload: { method: "turn/completed", params: {} }, type: "event" }),
  };
}

function setup() {
  const applied: number[] = [];
  const session = new NativeEngineSession({
    connection: { enabled: true, endpoint: "https://example.test", id: "server", token: "test" },
    connectionState: { setConnectionState: () => undefined },
    projection: {
      applyEvents: async (_id, events: SyncEvent[]) => {
        await Promise.resolve();
        for (const event of events) {
          applied.push(event.cursor);
        }
        return { checkpoint: Promise.resolve(), threads: new Map() };
      },
      applySnapshot: async () => undefined,
    },
  });
  sessions.push(session);
  const journal = (cursor: number) => {
    session.receive({
      connectionId: "server",
      contractVersion: 1,
      data: JSON.stringify({ recovery: false }),
      projectionCursor: cursor,
      type: "journalAdvanced",
    });
  };
  return { applied, journal };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  for (const session of sessions.splice(0)) {
    session.stop();
  }
});

describe("interest-filtered journal drain", () => {
  it("projects strictly increasing cursors with filtered gaps", async () => {
    const test = setup();
    native.readCommittedFrames.mockResolvedValueOnce({
      baseCursor: 10,
      frames: [committed(12), committed(15)],
      headCursor: 15,
    });

    test.journal(15);
    await settle();

    expect(test.applied).toEqual([12, 15]);
    expect(native.acknowledgeProjection).toHaveBeenLastCalledWith("server", 15);
  });

  it("closes a trailing skipped range after the last journal row", async () => {
    const test = setup();
    native.readCommittedFrames
      .mockResolvedValueOnce({ baseCursor: 10, frames: [committed(12)], headCursor: 20 })
      .mockResolvedValueOnce({ baseCursor: 12, frames: [], headCursor: 20 });

    test.journal(20);
    await settle();

    expect(test.applied).toEqual([12]);
    expect(native.readCommittedFrames).toHaveBeenLastCalledWith("server", 12);
    expect(native.acknowledgeProjection.mock.calls).toEqual([
      ["server", 12],
      ["server", 20],
    ]);
  });

  it("acknowledges an advance-only page without projecting anything", async () => {
    const test = setup();
    native.readCommittedFrames.mockResolvedValueOnce({ baseCursor: 10, frames: [], headCursor: 14 });

    test.journal(14);
    await settle();

    expect(test.applied).toEqual([]);
    expect(native.acknowledgeProjection).toHaveBeenCalledExactlyOnceWith("server", 14);
    test.journal(14);
    await settle();
    expect(native.readCommittedFrames).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a cursor that does not increase", async () => {
    const test = setup();
    native.readCommittedFrames.mockResolvedValueOnce({
      baseCursor: 10,
      frames: [committed(12), committed(12)],
      headCursor: 12,
    });

    test.journal(12);
    await settle();

    expect(test.applied).toEqual([]);
    expect(native.acknowledgeProjection).not.toHaveBeenCalled();
  });

  it("still rejects an empty page that does not reach the signalled head", async () => {
    const test = setup();
    native.readCommittedFrames.mockResolvedValueOnce({ baseCursor: 10, frames: [], headCursor: 10 });

    test.journal(14);
    await settle();

    expect(native.acknowledgeProjection).not.toHaveBeenCalled();
  });
});
