/**
 * Thread operations over Claude's session store: sessions started outside
 * CodeWide (for example, with `claude` in a terminal) are listed, read and
 * continued; rename and delete go through Claude's store with idempotent
 * repeats; the host keeps only its own metadata.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentThread, ThreadListParams } from "../src/protocol.js";
import type { StoredSession } from "../src/claude/port.js";
import { MemorySessionStore } from "./support/memoryStore.js";
import {
  createThread,
  frames,
  harness,
  prompt,
  settle,
  startedTurn,
  THREAD,
} from "./support/scripted.js";

const TERMINAL = "5a501bd2-3572-4b52-8537-b26e7278a1b5";
const PROGRAMMATIC = "49a1d081-235d-4f24-8144-d47c4b9c323d";

const listParams = (overrides: Partial<ThreadListParams> = {}): ThreadListParams => ({
  archived: false,
  cursor: null,
  cwd: null,
  limit: 50,
  searchTerm: null,
  sortDirection: "desc",
  sortKey: "updatedAt",
  window: null,
  ...overrides,
});

const terminalSession = (overrides: Partial<StoredSession> = {}): StoredSession => ({
  createdAtMs: 1_760_000_100_000,
  cwd: "/repo",
  fileSize: 1024,
  summary: "Flaky test fix",
  firstPrompt: "Fix the flaky test",
  lastModifiedMs: 1_760_000_200_000,
  sessionId: TERMINAL,
  title: "Flaky test fix",
  ...overrides,
});

const storedPrompt = (uuid: string, text: string) => ({
  message: { content: text, role: "user" },
  parent_agent_id: null,
  parent_tool_use_id: null,
  timestamp: "2026-10-01T10:00:00.000Z",
  type: "user",
  uuid,
});

const storedAnswer = (uuid: string, text: string) => ({
  message: { content: [{ text, type: "text" }], id: `msg_${uuid}`, role: "assistant" },
  parent_agent_id: null,
  parent_tool_use_id: null,
  timestamp: "2026-10-01T10:00:05.000Z",
  type: "assistant",
  uuid,
});

function storeWithTerminalSession(): MemorySessionStore {
  const store = new MemorySessionStore();
  store.addInteractive(terminalSession(), [
    storedPrompt("p-1", "Fix the flaky test"),
    storedAnswer("a-1", "Fixed."),
  ]);
  store.sessions.set(PROGRAMMATIC, {
    interactive: false,
    messages: [storedPrompt("p-2", "automation")],
    meta: terminalSession({ firstPrompt: "automation", sessionId: PROGRAMMATIC, title: null }),
  });
  return store;
}

const ids = (threads: readonly AgentThread[]): readonly string[] =>
  threads.map((thread) => thread.appThreadId);

async function listed(
  service: ReturnType<typeof harness>["service"],
  overrides: Partial<ThreadListParams> = {},
): Promise<readonly AgentThread[]> {
  const result = await service.list(listParams(overrides));
  if (result.status !== "ok") throw new Error(result.message);
  return result.value.threads;
}

describe("sessions started outside CodeWide", () => {
  it("lists interactive sessions next to CodeWide threads and hides other SDK sessions", async () => {
    const { service, queries } = harness({ store: storeWithTerminalSession() });
    createThread(service);
    expect(ids(await listed(service))).toEqual([TERMINAL]);
    startedTurn(await service.startTurn(THREAD, prompt("hello")));
    queries[0]?.push(frames.init);
    await settle();
    const threads = await listed(service);
    expect(ids(threads).toSorted()).toEqual([THREAD, TERMINAL].toSorted());
    expect(threads.find((thread) => thread.appThreadId === TERMINAL)).toMatchObject({
      archived: false,
      createdAt: 1_760_000_100,
      cwd: "/repo",
      name: "Flaky test fix",
      origin: "external",
      preview: "Fix the flaky test",
      settings: { model: "default", permissionProfile: ":read-only" },
      status: "notLoaded",
      updatedAt: 1_760_000_200,
    });
    expect(threads.find((thread) => thread.appThreadId === THREAD)).toMatchObject({
      origin: "interactive",
      preview: "hello",
    });
    expect(ids(await listed(service, { searchTerm: "flaky" }))).toEqual([TERMINAL]);
    expect(ids(await listed(service, { cwd: "/workspace" }))).toEqual([THREAD]);
  });

  it("reads, owns and returns the history of a session by its id", async () => {
    const { service } = harness({ store: storeWithTerminalSession() });
    expect(await service.owns(TERMINAL)).toBe(true);
    expect(await service.owns("0199a3c4-7a8e-7b2c-9d1e-000000000000")).toBe(false);
    expect(await service.read(TERMINAL)).toMatchObject({
      status: "ok",
      value: { activeTurnId: null, thread: { appThreadId: TERMINAL } },
    });
    const turns = await service.turns({
      appThreadId: TERMINAL,
      cursor: null,
      itemsView: "full",
      limit: 10,
      sortDirection: "asc",
    });
    expect(
      turns.status === "ok"
        ? turns.value.turns.map((turn) => [
            turn.turnId,
            turn.status,
            turn.items.map((item) => item.type),
          ])
        : [],
    ).toEqual([["p-1", "completed", ["userMessage", "agentMessage"]]]);
  });

  it("continues a session in its own directory by resuming it", async () => {
    const { service, queries } = harness({ store: storeWithTerminalSession() });
    startedTurn(await service.startTurn(TERMINAL, prompt("and the other one")));
    expect(queries[0]?.options).toMatchObject({
      cwd: "/repo",
      identity: { sessionId: TERMINAL, type: "resume" },
      profile: { profile: ":read-only" },
    });
  });

  it("renames through Claude's store and emits only on a real change", async () => {
    const { service, store, events } = harness({ store: storeWithTerminalSession() });
    expect(await service.update(TERMINAL, { name: "Renamed", type: "name" })).toMatchObject({
      status: "ok",
      value: { name: "Renamed" },
    });
    expect(store.renamed).toEqual([[TERMINAL, "Renamed"]]);
    const emitted = events.length;
    expect(await service.update(TERMINAL, { name: "Renamed", type: "name" })).toMatchObject({
      status: "ok",
      value: { name: "Renamed" },
    });
    expect(events.length).toBe(emitted);
    expect(store.renamed).toHaveLength(1);
    // Claude cannot clear a title: the host hides the current one.
    expect(await service.update(TERMINAL, { name: null, type: "name" })).toMatchObject({
      status: "ok",
      value: { name: null },
    });
    expect(
      (await listed(service)).find((thread) => thread.appThreadId === TERMINAL)?.name,
    ).toBeNull();
    expect(await service.update(TERMINAL, { name: "Back", type: "name" })).toMatchObject({
      status: "ok",
      value: { name: "Back" },
    });
  });

  it("archives with host metadata", async () => {
    const { service } = harness({ store: storeWithTerminalSession() });
    expect(await service.update(TERMINAL, { archived: true, type: "archived" })).toMatchObject({
      status: "ok",
      value: { archived: true },
    });
    expect(ids(await listed(service))).toEqual([]);
    expect(ids(await listed(service, { archived: true }))).toEqual([TERMINAL]);
  });

  it("deletes through Claude's store; repeats succeed and never resurrect the thread", async () => {
    const { service, store } = harness({ store: storeWithTerminalSession() });
    expect(await service.update(TERMINAL, { type: "deleted" })).toEqual({
      status: "ok",
      value: null,
    });
    expect(store.sessions.has(TERMINAL)).toBe(false);
    expect(await service.update(TERMINAL, { type: "deleted" })).toEqual({
      status: "ok",
      value: null,
    });
    expect(store.removed).toEqual([TERMINAL, TERMINAL]);
    expect(await service.read(TERMINAL)).toMatchObject({ code: -32_600, status: "error" });
    expect(ids(await listed(service))).toEqual([]);
    expect(
      await service.update("0199a3c4-7a8e-7b2c-9d1e-000000000000", { type: "deleted" }),
    ).toMatchObject({ status: "error" });
  });
});

describe("CodeWide threads in Claude's store", () => {
  it("applies a name given before Claude created the session once it exists", async () => {
    const { service, store, queries } = harness();
    createThread(service);
    expect(await service.update(THREAD, { name: "Early name", type: "name" })).toMatchObject({
      status: "ok",
      value: { name: "Early name" },
    });
    expect(store.renamed).toEqual([]);
    startedTurn(await service.startTurn(THREAD, prompt("hello")));
    queries[0]?.push(frames.init);
    await settle();
    expect(store.renamed).toEqual([[THREAD, "Early name"]]);
    expect(await service.read(THREAD)).toMatchObject({ value: { thread: { name: "Early name" } } });
  });

  it("deletes every session of the chain", async () => {
    const { service, store, queries } = harness();
    createThread(service);
    startedTurn(await service.startTurn(THREAD, prompt("hello")));
    queries[0]?.push(frames.init);
    queries[0]?.push(frames.result());
    await settle();
    expect(store.sessions.has(THREAD)).toBe(true);
    expect(await service.update(THREAD, { type: "deleted" })).toEqual({
      status: "ok",
      value: null,
    });
    expect(store.sessions.has(THREAD)).toBe(false);
    expect(await service.update(THREAD, { type: "deleted" })).toEqual({
      status: "ok",
      value: null,
    });
  });

  it("keeps no conversation in its own state", async () => {
    const { service, queries, stateDirectory } = harness();
    createThread(service);
    startedTurn(await service.startTurn(THREAD, prompt("a secret prompt")));
    queries[0]?.push(frames.init);
    queries[0]?.push(frames.text("m1", "a secret answer"));
    queries[0]?.push(frames.result());
    await settle();
    const files = readdirSync(join(stateDirectory, "threads", THREAD));
    expect(files).toEqual(["state.json"]);
    const state = readFileSync(join(stateDirectory, "threads", THREAD, "state.json"), "utf8");
    expect(state).not.toContain("secret");
  });
});

describe("version-1 journal", () => {
  it("converts metadata and the turn index, keeping turn ids and client message ids", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "claude-agent-host-legacy-"));
    const directory = join(stateDirectory, "threads", THREAD);
    mkdirSync(join(directory, "turns"), { recursive: true });
    const settings = {
      effort: null,
      model: "sonnet",
      permissionProfile: ":workspace",
      serviceTier: null,
    };
    writeFileSync(
      join(directory, "thread.json"),
      JSON.stringify({
        appThreadId: THREAD,
        archived: true,
        claudeSessionId: THREAD,
        createdAt: 10,
        cwd: "/workspace",
        deletedAt: null,
        firstUserMessage: "hello",
        name: "Old name",
        pendingSettings: null,
        preview: "hello",
        recencyAt: 11,
        sessionStarted: true,
        settings,
        totalUsage: {
          cachedInputTokens: 0,
          inputTokens: 1,
          outputTokens: 2,
          reasoningOutputTokens: 0,
          totalTokens: 3,
        },
        turnCount: 1,
        updatedAt: 12,
        version: 1,
      }),
    );
    const turn = {
      completedAt: 12,
      error: null,
      origin: "user",
      startedAt: 11,
      status: "completed",
      turnId: "legacy-turn",
      items: [
        {
          clientMessageId: "client-1",
          content: [{ text: "hello", type: "text" }],
          itemId: "legacy-turn:user:0",
          type: "userMessage",
        },
      ],
    };
    writeFileSync(
      join(directory, "turns", "00000001.json"),
      JSON.stringify({
        prompts: [{ clientMessageId: "client-1", uuid: "p-legacy" }],
        seq: 1,
        turn,
        version: 1,
      }),
    );
    const store = new MemorySessionStore();
    store.append({ cwd: "/workspace", sessionId: THREAD }, storedPrompt("p-legacy", "hello"));
    store.append({ cwd: "/workspace", sessionId: THREAD }, storedAnswer("a-legacy", "hi"));
    const { service } = harness({ stateDirectory, store });
    expect(service.load()).toEqual([]);
    expect(readdirSync(directory).toSorted()).toEqual(["state.json", "thread.json", "turns"]);
    await settle();
    expect(store.renamed).toEqual([[THREAD, "Old name"]]);
    expect(ids(await listed(service, { archived: true }))).toEqual([THREAD]);
    const turns = await service.turns({
      appThreadId: THREAD,
      cursor: null,
      itemsView: "full",
      limit: 10,
      sortDirection: "asc",
    });
    expect(
      turns.status === "ok"
        ? turns.value.turns.map((value) => [
            value.turnId,
            value.items[0]?.type === "userMessage" ? value.items[0].clientMessageId : null,
          ])
        : [],
    ).toEqual([["legacy-turn", "client-1"]]);
  });
});
