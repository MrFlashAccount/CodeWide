import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  appState: {
    currentState: "active" as string,
    listeners: new Map<string, (state: string) => void>(),
  },
  calls: [] as string[],
  native: {
    acknowledgeProjection: vi.fn(),
    attachSocket: vi.fn(async () => undefined),
    engineInterest: vi.fn(async () => undefined),
    engineListStream: vi.fn(async (_connectionId: string, _visible: boolean) => undefined),
    engineRpc: vi.fn(),
    readCommittedFrames: vi.fn(),
    resetSocket: vi.fn(),
  },
  nativeListeners: [] as Array<(event: unknown) => void>,
}));

// WHY: React Native's app lifecycle and native module registry cannot run in Node.
// Only these platform boundaries are replaced; the lifecycle, reconnect and engine owners run.
vi.mock("react-native", () => ({
  AppState: {
    addEventListener(type: string, listener: (state: string) => void) {
      platform.appState.listeners.set(type, listener);
      return { remove: () => platform.appState.listeners.delete(type) };
    },
    get currentState() {
      return platform.appState.currentState;
    },
  },
  NativeEventEmitter: class {
    addListener(_name: string, listener: (event: unknown) => void) {
      platform.nativeListeners.push(listener);
      return { remove() {} };
    }
  },
  NativeModules: { CodeWideNative: platform.native },
  PermissionsAndroid: {},
  Platform: { OS: "android" },
}));
vi.mock("../src/native/native-transport", () => ({ wakeNativeConnection: vi.fn() }));
// WHY: connection usability telemetry reaches secure storage through Expo native modules.
vi.mock("../src/data/connection-runtime", () => ({ recordConnectionUsability: vi.fn() }));

import { createCatalogLifecycle } from "../src/data/catalog-lifecycle";
import type { ConnectionStateRow } from "../src/data/connection-state-model";
import { createThreadSyncReconnect } from "../src/data/thread-sync-reconnect";
import type { ThreadListStreamSignal } from "../src/data/threadListStream";
import { NativeEngineSupervisor } from "../src/native/native-engine.native";

const settle = async () => {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
};

function lifecycle() {
  return createCatalogLifecycle({
    enabledConnectionIds: () => ["server"],
    refreshThreadCatalog: async (connectionId) => {
      platform.calls.push(`refresh:${connectionId}`);
    },
    setListStreamVisible: async (connectionId, visible) => {
      await Promise.resolve();
      platform.calls.push(`visible:${connectionId}:${String(visible)}`);
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  platform.calls.length = 0;
  platform.appState.currentState = "active";
  platform.appState.listeners.clear();
  platform.nativeListeners.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("thread-list stream visibility and re-read order", () => {
  it("declares visibility before the startup re-read", async () => {
    lifecycle().register(async () => undefined);
    await settle();
    expect(platform.calls).toEqual(["visible:server:true", "refresh:server"]);
  });

  it("hides the stream in the background and shows it before the foreground repair", async () => {
    lifecycle().register(async (connectionId) => {
      platform.calls.push(`repair:${connectionId}`);
    });
    await settle();
    platform.calls.length = 0;

    platform.appState.listeners.get("change")?.("background");
    await settle();
    expect(platform.calls).toEqual(["visible:server:false"]);

    platform.calls.length = 0;
    platform.appState.listeners.get("change")?.("active");
    await settle();
    expect(platform.calls).toEqual(["visible:server:true", "repair:server"]);
  });

  it("re-reads after a stable recovery and again for each new socket generation", async () => {
    vi.useFakeTimers();
    const refreshVisibleCatalog = vi.fn(async (_connectionId: string) => undefined);
    const row: ConnectionStateRow = {
      connectionId: "server",
      diagnostic: null,
      enabled: true,
      id: "server",
      rpcAvailable: true,
      state: "live",
    } as ConnectionStateRow;
    const reconnect = createThreadSyncReconnect({
      catalog: { refreshVisibleCatalog },
      details: { invalidateHistoryExhaustion: () => undefined },
      readConnection: () => row,
      refreshAccountRateLimits: async () => undefined,
      refreshAgentProviders: async () => undefined,
      sync: {
        desiredThreadId: () => undefined,
        invalidateHistoryReads: () => undefined,
        readThread: async () => null,
      },
    } as unknown as Parameters<typeof createThreadSyncReconnect>[0]);

    reconnect.observeGeneration("server", 1);
    reconnect.accept(row);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshVisibleCatalog).toHaveBeenCalledTimes(1);

    reconnect.observeGeneration("server", 1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshVisibleCatalog).toHaveBeenCalledTimes(1);

    reconnect.observeGeneration("server", 2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshVisibleCatalog).toHaveBeenCalledTimes(2);
    reconnect.close();
  });
});

describe("native engine thread-list stream", () => {
  function setup(accept: (signal: ThreadListStreamSignal) => "accepted" | "invalid") {
    const signals: ThreadListStreamSignal[] = [];
    const supervisor = new NativeEngineSupervisor({
      connectionState: { setConnectionState: () => undefined },
      desiredInterest: () => [],
      onThreadListStream: (_connectionId, signal) => {
        signals.push(signal);
        return accept(signal);
      },
      projection: {
        applyEvents: async () => ({ checkpoint: Promise.resolve(), threads: new Map() }),
        applySnapshot: async () => undefined,
      },
    });
    supervisor.replaceConnections([
      { enabled: true, endpoint: "https://example.test", id: "server", token: "test" },
    ]);
    const emit = (type: string, data: unknown) => {
      for (const listener of platform.nativeListeners) {
        listener({ connectionId: "server", contractVersion: 1, data: JSON.stringify(data), type });
      }
    };
    return { emit, signals, supervisor };
  }

  it("publishes each socket generation and forwards frames with theirs outside the journal", () => {
    const test = setup(() => "accepted");
    const frame = { removed: [{ cursor: 3, threadId: "gone" }], rows: [], type: "threadListRows" };
    test.emit("state", { generation: 4, rpcAvailable: true, state: "live" });
    test.emit("threadListRows", { frame, generation: 4 });

    expect(test.signals).toEqual([
      { generation: 4, kind: "generation" },
      { frame, generation: 4, kind: "rows" },
    ]);
    expect(platform.native.acknowledgeProjection).not.toHaveBeenCalled();
    expect(platform.native.resetSocket).not.toHaveBeenCalled();
    test.supervisor.stop();
  });

  it("resets the transport closed when the stream rejects a frame", () => {
    const test = setup((signal) => (signal.kind === "rows" ? "invalid" : "accepted"));
    test.emit("threadListRows", { frame: { rows: [] }, generation: 1 });
    test.emit("threadListRows", { frame: {} });
    expect(platform.native.resetSocket.mock.calls).toEqual([
      ["server", "invalid_list_rows"],
      ["server", "invalid_list_rows"],
    ]);
    test.supervisor.stop();
  });

  it("sends visibility through the native engine method", async () => {
    const test = setup(() => "accepted");
    await test.supervisor.listStreamVisible("server", true);
    expect(platform.native.engineListStream).toHaveBeenCalledExactlyOnceWith("server", true);
    test.supervisor.stop();
  });
});
