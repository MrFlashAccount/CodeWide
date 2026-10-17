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

import { createThreadInterestPort } from "../src/data/threadSyncInterest";
import { NativeEngineSupervisor } from "../src/native/native-engine.native";

const supervisors: NativeEngineSupervisor[] = [];
const settle = async () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function setup(desiredInterest: (connectionId: string) => readonly string[] = () => []) {
  const supervisor = new NativeEngineSupervisor({
    connectionState: { setConnectionState: () => undefined },
    desiredInterest,
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

  it("declares the JS-owned set, including changes made before the supervisor existed", async () => {
    let supervisor: NativeEngineSupervisor | null = null;
    const port = createThreadInterestPort(async (connectionId, threadIds) => {
      if (supervisor === null) {
        throw new Error("Workspace sync supervisor is not running");
      }
      await supervisor.interest(connectionId, threadIds);
    });
    port.update("server", "a", true);
    port.update("server", "b", true);
    await settle();
    expect(declared()).toEqual([]);

    const test = setup((connectionId) => port.threadIds(connectionId));
    supervisor = test.supervisor;
    test.state();
    test.state();
    await settle();

    expect(declared()).toEqual([["server", ["a", "b"]]]);
  });

  it("retries a rejected baseline with the current JS set on the next state event", async () => {
    let threadIds: readonly string[] = ["a"];
    const test = setup(() => threadIds);
    native.engineInterest.mockRejectedValueOnce(new Error("Connection service is not running"));

    test.state();
    await settle();
    threadIds = ["a", "b"];
    test.state();
    await settle();
    test.state();
    await settle();

    expect(declared()).toEqual([
      ["server", ["a"]],
      ["server", ["a", "b"]],
    ]);
  });
});
