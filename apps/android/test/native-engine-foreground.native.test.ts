import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteConnectionState, SyncEvent } from "@codewide/sync-client";

const native = vi.hoisted(() => ({
  attachSocket: vi.fn(async () => undefined),
  acknowledgeProjection: vi.fn(),
  readCommittedFrames: vi.fn(),
  engineRpc: vi.fn(),
}));

// WHY: React Native's native module registry cannot run in Node. Only the
// platform boundary is replaced; the real session and projection queues run.
vi.mock("react-native", () => ({
  NativeModules: { CodeWideNative: native },
  NativeEventEmitter: class { addListener() { return { remove() {} }; } },
  Platform: { OS: "android" },
  PermissionsAndroid: {},
}));

import { NativeEngineSession } from "../src/native/native-engine.native";

const sessions: NativeEngineSession[] = [];
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const states: RemoteConnectionState[] = [];
  const applied: number[] = [];
  const session = new NativeEngineSession({
    connection: { id: "server", endpoint: "https://example.test", token: "test", enabled: true },
    connectionState: { setConnectionState: (_id, state) => { states.push(state); } },
    projection: {
      applySnapshot: async () => undefined,
      applyEvents: async (_id, events: SyncEvent[]) => {
        for (const event of events) applied.push(event.cursor);
        return { checkpoint: Promise.resolve(), threads: new Map() };
      },
    },
  });
  sessions.push(session);
  const state = (value: RemoteConnectionState) => session.receive({
    contractVersion: 1, connectionId: "server", type: "state",
    data: JSON.stringify({ state: value, rpcAvailable: value === "live" }),
  });
  const journal = (cursor: number) => session.receive({
    contractVersion: 1, connectionId: "server", type: "journalAdvanced",
    projectionCursor: cursor, data: JSON.stringify({ recovery: true }),
  });
  return { session, states, applied, state, journal };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { for (const session of sessions.splice(0)) session.stop(); });

describe("warm foreground recovery", () => {
  it("rejects an RPC response when its native session was replaced before delivery", async () => {
    const test = setup();
    const response = Promise.withResolvers<string>();
    native.engineRpc.mockReturnValueOnce(response.promise);
    const pending = test.session.rpc("companion/thread/history/after", { threadId: "thread", afterTurnId: "turn" });
    test.session.stop();
    response.resolve(JSON.stringify({ ok: true, result: { data: [], hasMore: false } }));
    await expect(pending).rejects.toThrow("Native connection session was replaced");
    await expect(test.session.rpc("companion/thread/history/after", {}))
      .rejects.toThrow("Native connection session was replaced");
    expect(native.engineRpc).toHaveBeenCalledOnce();
  });

  it("does not turn an unchanged live connection into a fresh syncing/live transition", async () => {
    const test = setup();
    test.state("live");
    await settle();
    expect(test.states).toEqual(["syncing", "live"]);
    await test.session.reattachRuntime();
    test.state("live");
    await settle();
    expect(native.attachSocket).toHaveBeenCalledWith("server");
    expect(test.states).toEqual(["syncing", "live"]);
  });

  it("still publishes a genuine reconnect", async () => {
    const test = setup();
    test.state("live");
    await settle();
    test.state("connecting");
    test.state("live");
    await settle();
    expect(test.states).toEqual(["syncing", "live", "connecting", "syncing", "live"]);
  });

  it("does not hide recovery after an invalid native state", async () => {
    const test = setup();
    test.state("live");
    await settle();
    test.session.receive({
      contractVersion: 1, connectionId: "server", type: "state", data: "{}",
    });
    test.state("live");
    await settle();
    expect(test.states).toEqual(["syncing", "live", "degraded", "syncing", "live"]);
  });

  it("still waits for a new authoritative snapshot before publishing live", async () => {
    const test = setup();
    test.state("live");
    await settle();
    test.session.receive({
      contractVersion: 1, connectionId: "server", type: "snapshot",
      projectionCursor: 20, data: JSON.stringify({ cursor: 20, threads: [] }),
    });
    test.state("live");
    await settle();
    expect(native.acknowledgeProjection).toHaveBeenCalledWith("server", 20);
    expect(test.states).toEqual(["syncing", "live", "syncing", "live"]);
  });

  it("drains missing background events but does not re-read an already consumed journal head", async () => {
    const test = setup();
    native.readCommittedFrames.mockResolvedValue({ baseCursor: 10, headCursor: 10, frames: [] });
    native.readCommittedFrames.mockResolvedValueOnce({
      baseCursor: 9, headCursor: 10,
      frames: [{ cursor: 10, payload: JSON.stringify({
        type: "event", cursor: 10, payload: { method: "turn/completed", params: {} },
      }) }],
    });
    test.state("live");
    await settle();
    test.journal(10);
    test.state("live");
    await settle();
    expect(test.applied).toEqual([10]);
    expect(native.acknowledgeProjection).toHaveBeenCalledWith("server", 10);
    expect(test.states).toEqual(["syncing", "live", "syncing", "live"]);
    test.journal(10);
    test.state("live");
    await settle();
    expect(native.readCommittedFrames).toHaveBeenCalledTimes(1);
    expect(test.applied).toEqual([10]);
    expect(test.states).toEqual(["syncing", "live", "syncing", "live"]);
  });
});
