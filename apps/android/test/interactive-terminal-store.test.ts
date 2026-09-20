import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  close: vi.fn(),
  open: vi.fn(async () => undefined),
  releaseRenderer: vi.fn(async () => undefined),
  listener: null as
    | null
    | ((event: {
        sessionId: string;
        connectionId: string;
        threadId: string;
        type: "connecting" | "open" | "output" | "closed" | "error" | "removed";
        message?: string;
        offset?: number;
      }) => void),
  nextId: 1,
}));

vi.mock("expo-crypto", () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(native.nextId++).padStart(12, "0")}`,
}));

vi.mock("expo-libghostty", () => ({
  releasePersistentTerminalSession: native.releaseRenderer,
}));

vi.mock("../src/native/native-transport", () => ({
  closeNativeTerminal: native.close,
  openNativeTerminal: native.open,
  subscribeNativeTerminal: (listener: typeof native.listener) => {
    native.listener = listener;
    return () => undefined;
  },
}));

import {
  closeInteractiveTerminalTab,
  closeInteractiveTerminalSession,
  closeInteractiveTerminalWorkspace,
  commitInteractiveTerminalRenderedOffset,
  createInteractiveTerminalTab,
  focusInteractiveTerminalSession,
  readInteractiveTerminalRenderedOffset,
  readInteractiveTerminalWorkspace,
  selectInteractiveTerminalTab,
} from "../src/data/interactive-terminal-store.native";

describe("interactive terminal store", () => {
  beforeEach(() => {
    closeInteractiveTerminalWorkspace("server", "thread-a");
    closeInteractiveTerminalWorkspace("server", "thread-b");
    native.close.mockClear();
    native.open.mockClear();
    native.releaseRenderer.mockClear();
  });

  it("owns tabs per thread and creates them in the thread cwd", () => {
    const first = createInteractiveTerminalTab({
      connectionId: "server",
      threadId: "thread-a",
      cwd: "/repo/a",
    });
    const second = createInteractiveTerminalTab({
      connectionId: "server",
      threadId: "thread-a",
      cwd: "/repo/a",
    });
    createInteractiveTerminalTab({ connectionId: "server", threadId: "thread-b", cwd: "/repo/b" });

    expect(readInteractiveTerminalWorkspace("server", "thread-a")).toMatchObject({
      activeId: second,
      tabs: [
        { id: first, title: "Terminal 1", cwd: "/repo/a", threadId: "thread-a" },
        { id: second, title: "Terminal 2", cwd: "/repo/a", threadId: "thread-a" },
      ],
    });
    expect(readInteractiveTerminalWorkspace("server", "thread-b").tabs).toHaveLength(1);
    expect(native.open).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-a", cwd: "/repo/a" }),
    );
  });

  it("keeps completed tabs until explicit close and selects a neighbor", () => {
    const first = createInteractiveTerminalTab({
      connectionId: "server",
      threadId: "thread-a",
      cwd: "/repo",
    });
    const second = createInteractiveTerminalTab({
      connectionId: "server",
      threadId: "thread-a",
      cwd: "/repo",
    });
    selectInteractiveTerminalTab("server", "thread-a", first);

    native.listener?.({
      sessionId: first,
      connectionId: "server",
      threadId: "thread-a",
      type: "open",
    });
    native.listener?.({
      sessionId: first,
      connectionId: "server",
      threadId: "thread-a",
      type: "closed",
    });
    expect(readInteractiveTerminalWorkspace("server", "thread-a").tabs[0]?.status).toBe("closed");

    closeInteractiveTerminalTab("server", "thread-a", first);
    expect(readInteractiveTerminalWorkspace("server", "thread-a")).toMatchObject({
      activeId: second,
      tabs: [{ id: second }],
    });
    expect(native.close).toHaveBeenCalledWith(first);
  });

  it("focuses and closes a native-owned session without opening a replacement", () => {
    const sessionId = "terminal-00000000-0000-4000-8000-000000000099";
    focusInteractiveTerminalSession({
      connectionId: "server",
      cwd: "/repo",
      sessionId,
      status: "open",
      threadId: "thread-a",
    });

    expect(readInteractiveTerminalWorkspace("server", "thread-a")).toMatchObject({
      activeId: sessionId,
      tabs: [{ id: sessionId, status: "open" }],
    });
    expect(native.open).not.toHaveBeenCalled();

    closeInteractiveTerminalSession(sessionId);
    expect(native.close).toHaveBeenCalledWith(sessionId);
    expect(readInteractiveTerminalWorkspace("server", "thread-a").tabs).toHaveLength(0);
  });

  it("closes a native-owned session that is absent from the reloaded JS projection", () => {
    const sessionId = "terminal-00000000-0000-4000-8000-000000000098";

    closeInteractiveTerminalSession(sessionId);

    expect(native.close).toHaveBeenCalledWith(sessionId);
    expect(native.releaseRenderer).toHaveBeenCalledWith(sessionId);
    expect(native.open).not.toHaveBeenCalled();
  });

  it("removes tabs discarded by the native connection lifecycle", () => {
    const id = createInteractiveTerminalTab({
      connectionId: "server",
      threadId: "thread-a",
      cwd: "/repo",
    });
    native.listener?.({
      sessionId: id,
      connectionId: "server",
      threadId: "thread-a",
      type: "removed",
    });
    expect(readInteractiveTerminalWorkspace("server", "thread-a").tabs).toHaveLength(0);
  });

  it("keeps a monotonic renderer offset across workspace remounts", () => {
    const id = createInteractiveTerminalTab({
      connectionId: "server",
      threadId: "thread-a",
      cwd: "/repo",
    });
    expect(readInteractiveTerminalRenderedOffset(id)).toBe(0);
    commitInteractiveTerminalRenderedOffset(id, 120);
    expect(readInteractiveTerminalRenderedOffset(id)).toBe(120);
    expect(() => commitInteractiveTerminalRenderedOffset(id, 119)).toThrow(
      "Terminal render offset is invalid",
    );
    closeInteractiveTerminalTab("server", "thread-a", id);
    expect(readInteractiveTerminalRenderedOffset(id)).toBe(0);
    expect(native.releaseRenderer).toHaveBeenCalledWith(id);
  });
});
