import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  acknowledgeProjection: vi.fn(),
  attachSocket: vi.fn(async () => undefined),
  engineInterest: vi.fn(async (_connectionId: string, _threadIds: string) => undefined),
  engineRpc: vi.fn(),
  listeners: [] as Array<(event: unknown) => void>,
  readCommittedFrames: vi.fn(),
}));

// WHY: React Native's native module registry cannot run in Node. Only the
// platform boundary is replaced; the real supervisor and sessions run.
vi.mock("react-native", () => ({
  NativeEventEmitter: class {
    addListener(_name: string, listener: (event: unknown) => void) {
      native.listeners.push(listener);
      return { remove() {} };
    }
  },
  NativeModules: { CodeWideNative: native },
  PermissionsAndroid: {},
  Platform: { OS: "android" },
}));

import { NativeEngineSupervisor } from "../src/native/native-engine.native";

const supervisors: NativeEngineSupervisor[] = [];
const settle = async () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function setup() {
  const supervisor = new NativeEngineSupervisor({
    connectionState: { setConnectionState: () => undefined },
    projection: {
      applyEvents: async () => ({ checkpoint: Promise.resolve(), threads: new Map() }),
      applySnapshot: async () => undefined,
    },
  });
  supervisors.push(supervisor);
  supervisor.replaceConnections([
    { enabled: true, endpoint: "https://example.test", id: "server", token: "test" },
  ]);
  const state = () => {
    for (const listener of native.listeners) {
      listener({
        connectionId: "server",
        contractVersion: 1,
        data: JSON.stringify({ rpcAvailable: true, state: "live" }),
        type: "state",
      });
    }
  };
  return { state, supervisor };
}

// Thread id sets the engine received, in order.
const declared = () =>
  native.engineInterest.mock.calls.map(([connectionId, threadIds]) => [
    connectionId,
    JSON.parse(threadIds),
  ]);

beforeEach(() => {
  vi.clearAllMocks();
  native.listeners.length = 0;
});
afterEach(() => {
  for (const supervisor of supervisors.splice(0)) {
    supervisor.stop();
  }
});

describe("native interest baseline", () => {
  it("replaces a stale persisted set with an empty one once per session", async () => {
    const test = setup();

    test.state();
    test.state();
    await settle();

    expect(declared()).toEqual([["server", []]]);
  });

  it("redeclares the last JS-known set on the first state event only", async () => {
    const test = setup();
    await test.supervisor.interest("server", ["a", "b"]);

    test.state();
    test.state();
    await settle();

    expect(declared()).toEqual([
      ["server", ["a", "b"]],
      ["server", ["a", "b"]],
    ]);
  });

  it("retries a rejected baseline on the next state event", async () => {
    const test = setup();
    await test.supervisor.interest("server", ["a"]);
    native.engineInterest.mockRejectedValueOnce(new Error("Connection service is not running"));

    test.state();
    await settle();
    test.state();
    await settle();
    test.state();
    await settle();

    expect(declared()).toEqual([
      ["server", ["a"]],
      ["server", ["a"]],
      ["server", ["a"]],
    ]);
  });
});
