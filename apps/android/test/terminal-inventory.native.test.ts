import { afterEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  listTerminals: vi.fn(),
}));

// WHY: Node cannot load React Native's native registry. Only that platform
// boundary is replaced; the production terminal inventory adapter runs unchanged.
vi.mock("react-native", () => ({
  NativeEventEmitter: class {
    addListener() {
      return { remove: () => undefined };
    }
  },
  NativeModules: { CodeWideNative: platform },
  PermissionsAndroid: {},
  Platform: { OS: "android" },
}));

import {
  listNativeTerminals,
  parseNativeTerminalSession,
} from "../src/native/native-transport.native";

const running = {
  connectionId: "server-a",
  cwd: "/workspace/app",
  sessionId: "terminal-12345678-1234-1234-1234-123456789abc",
  status: "open",
  threadId: "thread-a",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("native terminal inventory", () => {
  it("reads validated running sessions from the native lifecycle owner", async () => {
    platform.listTerminals.mockResolvedValue(JSON.stringify([running]));

    await expect(listNativeTerminals()).resolves.toEqual([running]);
    expect(platform.listTerminals).toHaveBeenCalledOnce();
  });

  it("rejects incomplete or exited projections at the bridge boundary", () => {
    expect(() => parseNativeTerminalSession({ ...running, cwd: undefined })).toThrow(
      "Native terminal inventory is invalid",
    );
    expect(() => parseNativeTerminalSession({ ...running, status: "closed" })).toThrow(
      "Native terminal inventory is invalid",
    );
  });
});
