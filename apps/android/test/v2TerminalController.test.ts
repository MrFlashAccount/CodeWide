import { describe, expect, it, vi } from "vitest";

import type { TerminalLifecycle } from "../src/v2/application/ports/terminalLifecycle";
import {
  createVolatileTerminalSessionStore,
  type TerminalSessionStore,
} from "../src/v2/application/ports/terminalSessionStore";
import type {
  TerminalOpenInput,
  TerminalTransport,
  TerminalTransportEvent,
  TerminalTransportHandle,
} from "../src/v2/application/ports/terminalTransport";
import {
  TerminalController,
  type TerminalOutputEvent,
} from "../src/v2/application/terminalController";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { TerminalUtf8Decoder } from "../src/v2/infrastructure/terminal/terminalUtf8Decoder";
import { terminalComposerContextItem } from "../src/v2/features/terminal/terminalComposerContextItem";

const TWO_TERMINALS = 2;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const FOLD_COLS = 160;
const FOLD_ROWS = 50;
const FAILED_EXIT_CODE = 7;
const SCREEN_CURSOR_COLUMN = 5;
const SCREEN_CURSOR_ROW = 2;
const SCREEN_WIDTH = 5;
const CSI_PREFIX_LENGTH = 2;
const ESCAPE = "\u001B";
const ALTERNATE_SCREEN = `${ESCAPE}[?1049h`;

interface TerminalHarness {
  emit: (index: number, event: TerminalTransportEvent) => void;
  handles: Array<{
    close: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    input: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
  }>;
  lifecycle: TerminalLifecycle;
  opens: TerminalOpenInput[];
  reconnects: Array<() => void>;
  runNextReconnect: () => void;
  transport: TerminalTransport;
}

describe("V2 Terminal controller", () => {
  it("exposes a composer chip only while terminal tabs exist", () => {
    expect(
      terminalComposerContextItem({ errorCount: 0, liveCount: 0, sessionCount: 0 }),
    ).toBeNull();
    expect(
      terminalComposerContextItem({
        errorCount: 0,
        liveCount: 1,
        sessionCount: TWO_TERMINALS,
      }),
    ).toStrictEqual({ icon: "terminal", id: "terminal", label: "Terminals: 2" });
  });

  it("keeps replay offsets behind an incomplete UTF-8 code point", () => {
    const decoder = new TerminalUtf8Decoder("8");
    const emojiBytes = new TextEncoder().encode("😀");
    const emojiMiddle = emojiBytes.length / TWO_TERMINALS;
    const firstEmojiBytes = emojiBytes.subarray(0, emojiMiddle);
    const lastEmojiBytes = emojiBytes.subarray(emojiMiddle);

    expect(decoder.push("8", firstEmojiBytes)).toBeNull();
    expect(decoder.push("10", lastEmojiBytes)).toStrictEqual({
      data: "😀",
      nextOffset: "12",
      offset: "8",
    });
  });

  it("keeps tabs alive across renderer and route subscriptions", async () => {
    const harness = terminalHarness();
    const controller = new TerminalController(harness.transport, harness.lifecycle);
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));

    const id = await controller.open(owner, "7", "/workspace");
    harness.emit(0, { offset: "0", type: "opened" });
    expect(controller.workspaceSnapshot(owner).sessions).toMatchObject([
      { id, status: "live", title: "Terminal 1" },
    ]);

    const unsubscribe = controller.subscribe(() => undefined);
    const detach = controller.attachRenderer(id);
    unsubscribe();
    detach();
    expect(controller.workspaceSnapshot(owner).sessions).toHaveLength(1);
    expect(harness.handles[0]?.close).not.toHaveBeenCalled();
  });

  it("admits only one terminal when concurrent opens race durable storage", async () => {
    const harness = terminalHarness();
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    let admit = (): void => undefined;
    const admission = new Promise<void>((resolve) => {
      admit = resolve;
    });
    const store: TerminalSessionStore = {
      delete: () => Promise.resolve(),
      deleteSavedServer: () => Promise.resolve(),
      list: () => Promise.resolve([]),
      upsert: vi.fn(() => admission),
    };
    const controller = new TerminalController(harness.transport, harness.lifecycle, store);

    const first = controller.open(owner, "7", "/workspace");
    const second = controller.open(owner, "7", "/workspace");

    expect(harness.opens).toHaveLength(0);
    admit();
    const [firstId, secondId] = await Promise.all([first, second]);

    expect(firstId).toBe(secondId);
    expect(store.upsert).toHaveBeenCalledTimes(1);
    expect(harness.opens).toHaveLength(1);
    expect(controller.workspaceSnapshot(owner).sessions).toHaveLength(1);
  });

  it("rebuilds a fresh renderer from zero after background output", async () => {
    const harness = terminalHarness();
    const controller = new TerminalController(harness.transport, harness.lifecycle);
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const id = await controller.open(owner, "7", "/workspace");
    harness.emit(0, { offset: "0", type: "opened" });
    const detach = controller.attachRenderer(id);
    const output = vi.fn(async (_event: TerminalOutputEvent) => {
      await Promise.resolve();
    });
    const unsubscribe = controller.subscribeOutput(id, output);

    harness.emit(0, { data: "hello", nextOffset: "5", offset: "0", type: "output" });
    detach();
    unsubscribe();
    harness.emit(0, { data: " world", nextOffset: "11", offset: "5", type: "output" });
    controller.attachRenderer(id);
    await vi.waitFor(() => {
      expect(harness.opens).toHaveLength(TWO_TERMINALS);
    });

    expect(harness.handles[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.opens[1]).toMatchObject({ create: false, offset: "0", sessionId: id });
  });

  it("rebuilds a fresh renderer from zero after a clean route remount", async () => {
    const harness = terminalHarness();
    const controller = new TerminalController(harness.transport, harness.lifecycle);
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const id = await controller.open(owner, "7", "/workspace");
    harness.emit(0, { offset: "0", type: "opened" });
    const detach = controller.attachRenderer(id);
    controller.subscribeOutput(id, async () => {
      await Promise.resolve();
    });
    harness.emit(0, { data: "ready", nextOffset: "5", offset: "0", type: "output" });
    detach();

    controller.attachRenderer(id);
    await vi.waitFor(() => {
      expect(harness.opens).toHaveLength(TWO_TERMINALS);
    });

    expect(harness.opens[1]).toMatchObject({ create: false, offset: "0", sessionId: id });
  });

  it("recovers an unexpected disconnect with the same session and replay cursor", async () => {
    const harness = terminalHarness();
    const controller = new TerminalController(harness.transport, harness.lifecycle);
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const id = await controller.open(owner, "9", null);
    harness.emit(0, { offset: "0", type: "opened" });
    controller.attachRenderer(id);
    controller.subscribeOutput(id, async () => {
      await Promise.resolve();
    });
    harness.emit(0, { data: "ok", nextOffset: "2", offset: "0", type: "output" });

    harness.emit(0, { type: "disconnected" });
    expect(controller.workspaceSnapshot(owner).sessions[0]?.status).toBe("connecting");
    harness.runNextReconnect();
    await vi.waitFor(() => {
      expect(harness.opens).toHaveLength(TWO_TERMINALS);
    });

    expect(harness.opens[1]).toMatchObject({
      create: false,
      generation: "9",
      offset: "2",
      sessionId: id,
    });
  });

  it("replays from the last acknowledged offset after renderer delivery rejects", async () => {
    const harness = terminalHarness();
    const controller = new TerminalController(harness.transport, harness.lifecycle);
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const id = await controller.open(owner, "9", null);
    harness.emit(0, { offset: "0", type: "opened" });
    controller.attachRenderer(id);
    const applied: string[] = [];
    let rejectNext = true;
    const output = vi.fn(async (event: TerminalOutputEvent) => {
      await Promise.resolve();
      if (rejectNext) {
        rejectNext = false;
        throw new Error("Ghostty write failed");
      }
      applied.push(event.data);
    });
    controller.subscribeOutput(id, output);

    harness.emit(0, { data: "hello", nextOffset: "5", offset: "0", type: "output" });
    await vi.waitFor(() => {
      expect(harness.opens).toHaveLength(TWO_TERMINALS);
    });

    expect(harness.handles[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.opens[1]).toMatchObject({ create: false, offset: "0", sessionId: id });
    expect(applied).toStrictEqual([]);

    harness.emit(1, { offset: "0", type: "opened" });
    harness.emit(1, { data: "hello", nextOffset: "5", offset: "0", type: "output" });
    await vi.waitFor(() => {
      expect(applied).toStrictEqual(["hello"]);
    });

    harness.emit(1, { type: "disconnected" });
    harness.runNextReconnect();
    await vi.waitFor(() => {
      expect(harness.opens).toHaveLength(TWO_TERMINALS + 1);
    });
    expect(harness.opens[TWO_TERMINALS]).toMatchObject({
      create: false,
      offset: "5",
      sessionId: id,
    });
  });

  it("reattaches durable terminal identities after Android process restart", async () => {
    const store = createVolatileTerminalSessionStore();
    const firstHarness = terminalHarness();
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const firstController = new TerminalController(
      firstHarness.transport,
      firstHarness.lifecycle,
      store,
    );
    const id = await firstController.open(owner, "9", "/workspace");
    firstHarness.emit(0, { offset: "17", type: "opened" });

    const restartedHarness = terminalHarness();
    const restartedController = new TerminalController(
      restartedHarness.transport,
      restartedHarness.lifecycle,
      store,
    );
    await restartedController.start();

    expect(restartedHarness.opens).toStrictEqual([
      expect.objectContaining({
        create: false,
        cwd: "/workspace",
        generation: "9",
        offset: "0",
        owner,
        sessionId: id,
      }),
    ]);
    expect(restartedController.workspaceSnapshot(owner).sessions).toMatchObject([
      { id, status: "connecting", title: "Terminal 1" },
    ]);
    expect(firstHarness.handles[0]?.close).not.toHaveBeenCalled();
  });

  it("reconstructs screen content and cursor from exact replay after process restart", async () => {
    const store = createVolatileTerminalSessionStore();
    const firstHarness = terminalHarness();
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const firstController = new TerminalController(
      firstHarness.transport,
      firstHarness.lifecycle,
      store,
    );
    const id = await firstController.open(owner, "9", "/workspace");
    firstHarness.emit(0, { offset: "0", type: "opened" });

    const restartedHarness = terminalHarness();
    const restartedController = new TerminalController(
      restartedHarness.transport,
      restartedHarness.lifecycle,
      store,
    );
    await restartedController.start();
    const screen = new TerminalScreenProbe();
    restartedController.subscribeOutput(id, async (event) => {
      screen.write(event.data);
      await Promise.resolve();
    });
    restartedController.attachRenderer(id);

    const retainedReplay = `old\r\nstate${ALTERNATE_SCREEN}build${ESCAPE}[3;5H!`;
    restartedHarness.emit(0, { offset: "0", type: "opened" });
    restartedHarness.emit(0, {
      data: retainedReplay,
      nextOffset: String(new TextEncoder().encode(retainedReplay).length),
      offset: "0",
      type: "output",
    });
    await vi.waitFor(() => {
      expect(screen.snapshot().alternate).toBe(true);
    });

    expect(screen.snapshot()).toStrictEqual({
      alternate: true,
      cursor: { column: SCREEN_CURSOR_COLUMN, row: SCREEN_CURSOR_ROW },
      visibleText: "build\n\n    !",
    });
  });

  it("drops persisted terminal identities for unavailable saved servers", async () => {
    const store = createVolatileTerminalSessionStore();
    const allowedOwner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const removedOwner = qualifiedThread(savedServerId("server-b"), threadId("thread-b"));
    await store.upsert({
      cols: DEFAULT_COLS,
      cwd: "/allowed",
      generation: "1",
      id: "terminal-allowed",
      owner: allowedOwner,
      rows: DEFAULT_ROWS,
      title: "Terminal 1",
    });
    await store.upsert({
      cols: DEFAULT_COLS,
      cwd: "/removed",
      generation: "1",
      id: "terminal-removed",
      owner: removedOwner,
      rows: DEFAULT_ROWS,
      title: "Terminal 1",
    });
    const harness = terminalHarness();
    const controller = new TerminalController(harness.transport, harness.lifecycle, store);

    await controller.start([allowedOwner.savedServerId]);

    expect(harness.opens).toHaveLength(1);
    expect(harness.opens[0]?.sessionId).toBe("terminal-allowed");
    expect(await store.list()).toHaveLength(1);
  });

  it("forgets a lost replay identity and retries with a fresh shell", async () => {
    const store = createVolatileTerminalSessionStore();
    const harness = terminalHarness();
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const controller = new TerminalController(harness.transport, harness.lifecycle, store);
    const id = await controller.open(owner, "9", "/workspace");
    harness.emit(0, { offset: "0", type: "opened" });
    expect(await store.list()).toHaveLength(1);

    harness.emit(0, {
      error: { code: "replayUnavailable", message: "Terminal replay unavailable" },
      type: "error",
    });
    await vi.waitFor(async () => {
      expect(await store.list()).toStrictEqual([]);
    });
    expect(controller.workspaceSnapshot(owner).sessions).toMatchObject([
      {
        error: "Terminal replay unavailable",
        errorCode: "replayUnavailable",
        id,
        status: "failed",
      },
    ]);

    const retryId = await controller.retryReplay(id);

    expect(retryId).not.toBe(id);
    expect(harness.opens).toHaveLength(TWO_TERMINALS);
    expect(harness.opens[1]).toMatchObject({ create: true, offset: "0", sessionId: retryId });
    expect(controller.workspaceSnapshot(owner).sessions).toMatchObject([
      { error: null, errorCode: null, id: retryId, status: "connecting" },
    ]);
  });

  it("keeps input and the latest fold size on the active connection and reconnect", async () => {
    const harness = terminalHarness();
    const controller = new TerminalController(harness.transport, harness.lifecycle);
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const id = await controller.open(owner, "9", null);
    harness.emit(0, { offset: "0", type: "opened" });

    await controller.input(id, "pwd\n");
    await controller.resize(id, FOLD_COLS, FOLD_ROWS);
    expect(harness.handles[0]?.input).toHaveBeenCalledWith("pwd\n");
    expect(harness.handles[0]?.resize).toHaveBeenCalledWith(FOLD_COLS, FOLD_ROWS);

    harness.emit(0, { type: "disconnected" });
    harness.runNextReconnect();
    await vi.waitFor(() => {
      expect(harness.opens).toHaveLength(TWO_TERMINALS);
    });
    expect(harness.opens[1]).toMatchObject({ cols: FOLD_COLS, rows: FOLD_ROWS });
  });

  it("surfaces replay loss and exit without recreating the shell", async () => {
    const harness = terminalHarness();
    const controller = new TerminalController(harness.transport, harness.lifecycle);
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const first = await controller.open(owner, "2", null);
    harness.emit(0, {
      error: { code: "replayUnavailable", message: "Terminal replay unavailable" },
      type: "error",
    });
    expect(controller.workspaceSnapshot(owner).sessions[0]).toMatchObject({
      error: "Terminal replay unavailable",
      status: "failed",
    });
    expect(harness.reconnects).toHaveLength(0);

    const second = await controller.open(owner, "2", null);
    harness.emit(1, { offset: "0", type: "opened" });
    harness.emit(1, {
      exitCode: FAILED_EXIT_CODE,
      offset: "4",
      signal: null,
      type: "exited",
    });
    await vi.waitFor(() => {
      expect(
        controller.workspaceSnapshot(owner).sessions.find((candidate) => candidate.id === second)
          ?.status,
      ).toBe("closed");
    });
    expect(
      controller.workspaceSnapshot(owner).sessions.find((candidate) => candidate.id === second),
    ).toMatchObject({ exitCode: FAILED_EXIT_CODE, signal: null, status: "closed" });
    expect(
      controller.workspaceSnapshot(owner).sessions.find((candidate) => candidate.id === first)
        ?.status,
    ).toBe("failed");
  });

  it("replays an exited terminal tail that arrived while its renderer was absent", async () => {
    const harness = terminalHarness();
    const controller = new TerminalController(harness.transport, harness.lifecycle);
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const id = await controller.open(owner, "2", null);
    harness.emit(0, { offset: "0", type: "opened" });
    harness.emit(0, { data: "done", nextOffset: "4", offset: "0", type: "output" });
    harness.emit(0, { exitCode: 0, offset: "4", signal: null, type: "exited" });
    await vi.waitFor(() => {
      expect(controller.workspaceSnapshot(owner).sessions[0]?.status).toBe("closed");
    });

    const output = vi.fn(async (_event: TerminalOutputEvent) => {
      await Promise.resolve();
    });
    controller.subscribeOutput(id, output);
    controller.attachRenderer(id);
    await vi.waitFor(() => {
      expect(harness.opens).toHaveLength(TWO_TERMINALS);
    });
    expect(harness.opens[1]).toMatchObject({ create: false, offset: "0", sessionId: id });

    harness.emit(1, { offset: "0", type: "opened" });
    harness.emit(1, { data: "done", nextOffset: "4", offset: "0", type: "output" });
    harness.emit(1, { exitCode: 0, offset: "4", signal: null, type: "exited" });
    await vi.waitFor(() => {
      expect(output).toHaveBeenCalledTimes(1);
      expect(controller.workspaceSnapshot(owner).sessions[0]?.status).toBe("closed");
    });
  });

  it("closes only explicit tabs and disposes every tab at runtime shutdown", async () => {
    const harness = terminalHarness();
    const controller = new TerminalController(harness.transport, harness.lifecycle);
    const firstOwner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const secondOwner = qualifiedThread(savedServerId("server-b"), threadId("thread-b"));
    const first = await controller.open(firstOwner, "1", null);
    await controller.open(secondOwner, "1", null);

    expect(controller.overviewSnapshot()).toMatchObject({ sessionCount: TWO_TERMINALS });
    await controller.close(firstOwner, first);
    expect(harness.handles[0]?.close).toHaveBeenCalledTimes(1);
    expect(controller.workspaceSnapshot(secondOwner).sessions).toHaveLength(1);

    await controller.closeAll();
    expect(harness.handles[1]?.close).toHaveBeenCalledTimes(1);
    expect(controller.overviewSnapshot().sessionCount).toBe(0);
  });
});

function terminalHarness(): TerminalHarness {
  const opens: TerminalOpenInput[] = [];
  const listeners: Array<(event: TerminalTransportEvent) => void> = [];
  const reconnects: Array<() => void> = [];
  const handles: Array<{
    close: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    input: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
  }> = [];
  let nextId = 0;
  const transport: TerminalTransport = {
    createSessionId: () => {
      nextId += 1;
      return `terminal-${String(nextId)}`;
    },
    open: async (input, listener) => {
      await Promise.resolve();
      opens.push(input);
      listeners.push(listener);
      const close = vi.fn(async () => {
        await Promise.resolve();
      });
      const disconnect = vi.fn(async () => {
        await Promise.resolve();
      });
      const terminalInput = vi.fn(async () => {
        await Promise.resolve();
      });
      const resize = vi.fn(async () => {
        await Promise.resolve();
      });
      handles.push({ close, disconnect, input: terminalInput, resize });
      const handle: TerminalTransportHandle = {
        close,
        disconnect,
        input: terminalInput,
        resize,
      };
      return handle;
    },
  };
  return {
    emit(index, event) {
      const listener = listeners.at(index);
      if (listener === undefined) {
        throw new Error("Terminal listener is unavailable");
      }
      listener(event);
    },
    handles,
    lifecycle: {
      scheduleReconnect(_attempt, reconnect) {
        reconnects.push(reconnect);
        return () => undefined;
      },
    },
    opens,
    reconnects,
    runNextReconnect() {
      const reconnect = reconnects.shift();
      if (reconnect === undefined) {
        throw new Error("Reconnect is unavailable");
      }
      reconnect();
    },
    transport,
  };
}

class TerminalScreenProbe {
  readonly #alternateCells = new Map<string, string>();
  readonly #primaryCells = new Map<string, string>();
  #alternate = false;
  #column = 0;
  #row = 0;

  write(data: string): void {
    let position = 0;
    while (position < data.length) {
      const remaining = data.slice(position);
      if (remaining.startsWith(ALTERNATE_SCREEN)) {
        this.#alternate = true;
        this.#alternateCells.clear();
        this.#column = 0;
        this.#row = 0;
        position += ALTERNATE_SCREEN.length;
        continue;
      }
      const cursor = parseCursorPosition(remaining);
      if (cursor !== null) {
        this.#row = cursor.row;
        this.#column = cursor.column;
        position += cursor.consumed;
        continue;
      }
      const character = data.charAt(position);
      if (character === "\r") {
        this.#column = 0;
      } else if (character === "\n") {
        this.#row += 1;
      } else {
        this.#cells().set(`${String(this.#row)}:${String(this.#column)}`, character);
        this.#column += 1;
      }
      position += 1;
    }
  }

  snapshot(): {
    alternate: boolean;
    cursor: { column: number; row: number };
    visibleText: string;
  } {
    const lines: string[] = [];
    for (let row = 0; row <= this.#row; row += 1) {
      let line = "";
      for (let column = 0; column < Math.max(this.#column, SCREEN_WIDTH); column += 1) {
        line += this.#cells().get(`${String(row)}:${String(column)}`) ?? " ";
      }
      lines.push(line.trimEnd());
    }
    return {
      alternate: this.#alternate,
      cursor: { column: this.#column, row: this.#row },
      visibleText: lines.join("\n"),
    };
  }

  #cells(): Map<string, string> {
    return this.#alternate ? this.#alternateCells : this.#primaryCells;
  }
}

interface CursorPosition {
  column: number;
  consumed: number;
  row: number;
}

function parseCursorPosition(value: string): CursorPosition | null {
  if (!value.startsWith(`${ESCAPE}[`)) {
    return null;
  }
  const end = value.indexOf("H");
  if (end < 0) {
    return null;
  }
  const fields = value.slice(CSI_PREFIX_LENGTH, end).split(";");
  if (fields.length !== TWO_TERMINALS) {
    return null;
  }
  const row = Number(fields[0]);
  const column = Number(fields[1]);
  if (!Number.isInteger(row) || row < 1 || !Number.isInteger(column) || column < 1) {
    return null;
  }
  return { column: column - 1, consumed: end + 1, row: row - 1 };
}
