/**
 * `nativeSession.list` / `nativeSession.read`: the contract the companion's
 * native Claude index relies on — every session listed with cheap change
 * metadata, deterministic reads (same stored input → same turns and ids),
 * the host's `clientMessageId` echo, live snapshots of running turns,
 * sub-agent transcripts, and v1 result shapes.
 */

import { ModelCatalog } from "../src/catalog/models.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkMessage } from "@codewide/agent-protocol";
import { createMemoryLogger } from "../src/log.js";
import { asClientMessageId } from "../src/protocol.js";
import { RpcServer } from "../src/rpc/server.js";
import { MemorySessionStore } from "./support/memoryStore.js";
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

const TERMINAL = "ed607e83-c55b-44f3-a3b7-f7164d6eadf9";
const PROGRAMMATIC = "49a1d081-235d-4f24-8144-d47c4b9c323d";

function sessionMessages(name: string): readonly unknown[] {
  const parsed: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", "sessions", `${name}.json`), "utf8"),
  );
  const messages =
    typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "messages") : null;
  if (!Array.isArray(messages)) throw new Error(`${name} has no messages`);
  return messages;
}

function store(): MemorySessionStore {
  const memory = new MemorySessionStore();
  memory.addInteractive(
    {
      createdAtMs: 1_791_542_431_841,
      cwd: "/workspace",
      fileSize: 166_409,
      firstPrompt: "Run the shell command `sleep 25`",
      lastModifiedMs: 1_791_542_553_960,
      sessionId: TERMINAL,
      summary: "Sleep 25",
      title: "Sleep 25",
    },
    sessionMessages("background_wake_steer_interrupt"),
  );
  memory.sessions.set(PROGRAMMATIC, {
    interactive: false,
    messages: [...sessionMessages("three_tools_final")],
    meta: {
      createdAtMs: 1_791_547_991_000,
      cwd: "/other",
      fileSize: 7441,
      firstPrompt: "Do these three steps",
      lastModifiedMs: 1_791_548_002_000,
      sessionId: PROGRAMMATIC,
      summary: "Three steps",
      title: null,
    },
  });
  return memory;
}

const list = { cursor: null, dir: null, limit: 50 };

describe("nativeSession.list", () => {
  it("lists every session newest first with change metadata and the interactive flag", async () => {
    const { service } = harness({ store: store() });
    const result = await service.nativeSessions(list);
    expect(result).toMatchObject({
      status: "ok",
      value: {
        nextCursor: null,
        sessions: [
          {
            appThreadId: PROGRAMMATIC,
            fileSize: 7441,
            interactive: false,
            lastModifiedMs: 1_791_548_002_000,
            sessionId: PROGRAMMATIC,
          },
          {
            appThreadId: TERMINAL,
            cwd: "/workspace",
            fileSize: 166_409,
            interactive: true,
            sessionId: TERMINAL,
            summary: "Sleep 25",
            title: "Sleep 25",
          },
        ],
      },
    });
  });

  it("pages with an opaque cursor, narrows to one directory and rejects a foreign cursor", async () => {
    const { service } = harness({ store: store() });
    const first = await service.nativeSessions({ ...list, limit: 1 });
    expect(
      first.status === "ok"
        ? [first.value.sessions.map((session) => session.sessionId), first.value.nextCursor]
        : null,
    ).toEqual([[PROGRAMMATIC], "v1:1"]);
    const second = await service.nativeSessions({ ...list, cursor: "v1:1", limit: 1 });
    expect(
      second.status === "ok"
        ? [second.value.sessions.map((session) => session.sessionId), second.value.nextCursor]
        : null,
    ).toEqual([[TERMINAL], null]);
    const narrowed = await service.nativeSessions({ ...list, dir: "/workspace" });
    expect(
      narrowed.status === "ok" ? narrowed.value.sessions.map((session) => session.sessionId) : null,
    ).toEqual([TERMINAL]);
    expect(await service.nativeSessions({ ...list, cursor: "page-2" })).toMatchObject({
      code: -32_602,
      status: "error",
    });
  });

  it("maps a CodeWide thread's session to its thread", async () => {
    const { service, queries } = harness({ store: store() });
    createThread(service);
    startedTurn(await service.startTurn(THREAD, prompt("hello")));
    queries[0]?.push(frames.init);
    queries[0]?.push(frames.result());
    await settle();
    const result = await service.nativeSessions({ ...list, dir: "/workspace" });
    expect(
      result.status === "ok"
        ? result.value.sessions.find((session) => session.sessionId === THREAD)
        : null,
    ).toMatchObject({ appThreadId: THREAD, interactive: false });
  });
});

describe("nativeSession.read", () => {
  it("reads the same stored input as the same turns and ids", async () => {
    const { service } = harness({ store: store() });
    const first = await service.readNativeSession(TERMINAL);
    const second = await service.readNativeSession(TERMINAL);
    expect(first.status).toBe("ok");
    expect(second).toEqual(first);
    expect(
      first.status === "ok" ? first.value.turns.map((turn) => [turn.origin, turn.status]) : null,
    ).toEqual([
      ["user", "completed"],
      ["user", "interrupted"],
      ["user", "completed"],
      ["provider", "completed"],
    ]);
    expect(first.status === "ok" ? first.value.session : null).toMatchObject({
      appThreadId: TERMINAL,
      interactive: true,
      sessionId: TERMINAL,
    });
  });

  it("answers an unknown session with the protocol error", async () => {
    const { service } = harness({ store: store() });
    expect(await service.readNativeSession("00000000-0000-4000-8000-000000000000")).toEqual({
      code: -32_600,
      message: "native session not found: 00000000-0000-4000-8000-000000000000",
      status: "error",
    });
  });

  it("echoes client message ids, keeps live turn ids and serves a running turn as its snapshot", async () => {
    const { service, queries } = harness({ store: store() });
    createThread(service);
    const first = startedTurn(
      await service.startTurn(THREAD, {
        clientMessageId: null,
        input: [{ text: "one", type: "text" }],
      }),
    );
    queries[0]?.push(frames.init);
    queries[0]?.push(frames.text("m1", "done"));
    queries[0]?.push(frames.result());
    await settle();
    const second = startedTurn(
      await service.startTurn(THREAD, {
        clientMessageId: asClientMessageId("client-2"),
        input: [{ text: "two", type: "text" }],
      }),
    );
    const read = await service.readNativeSession(THREAD);
    expect(
      read.status === "ok" ? read.value.turns.map((turn) => [turn.turnId, turn.status]) : null,
    ).toEqual([
      [first, "completed"],
      [second, "inProgress"],
    ]);
    const echoed = read.status === "ok" ? read.value.turns[1]?.items[0] : null;
    expect(echoed).toMatchObject({ clientMessageId: "client-2", type: "userMessage" });
  });

  it("includes sub-agent transcripts linked to their spawning tool call", async () => {
    const memory = store();
    const subagent = [
      {
        message: { content: "Find the failing test", role: "user" },
        parent_agent_id: null,
        parent_tool_use_id: "toolu_task",
        timestamp: "2026-10-01T10:00:00.000Z",
        type: "user",
        uuid: "s-1",
      },
      {
        message: {
          content: [{ text: "None fail.", type: "text" }],
          id: "msg_sub",
          role: "assistant",
        },
        parent_agent_id: null,
        parent_tool_use_id: "toolu_task",
        timestamp: "2026-10-01T10:00:02.000Z",
        type: "assistant",
        uuid: "s-2",
      },
    ];
    memory.subagentTranscripts.set(TERMINAL, new Map([["a05d989c3914f829e", subagent]]));
    const { service } = harness({ store: memory });
    const read = await service.readNativeSession(TERMINAL);
    expect(read.status === "ok" ? read.value.subagents : null).toEqual([
      {
        agentId: "a05d989c3914f829e",
        parentAgentId: null,
        parentToolUseId: "toolu_task",
        turns: [
          expect.objectContaining({
            items: [
              expect.objectContaining({ itemId: "s-1:user:0", type: "userMessage" }),
              expect.objectContaining({ itemId: "msg_sub:0", phase: "final", text: "None fail." }),
            ],
            status: "completed",
            turnId: "s-1",
          }),
        ],
      },
    ]);
  });

  it("keeps a still-running background sub-agent's last turn in progress", async () => {
    const memory = new MemorySessionStore();
    const fixture: unknown = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "fixtures", "sessions", "interactive_terminal_subagents.json"),
        "utf8",
      ),
    );
    const subagents: unknown =
      typeof fixture === "object" && fixture !== null ? Reflect.get(fixture, "subagents") : null;
    if (typeof subagents !== "object" || subagents === null) throw new Error("no sub-agents");
    const sessionId = "5f0c2a1e-3b4d-4e6f-8a9b-0c1d2e3f4a5b";
    memory.addInteractive(
      {
        createdAtMs: 1_791_547_200_000,
        cwd: "/workspace",
        fileSize: 4096,
        firstPrompt: "Plan the release and check the build.",
        lastModifiedMs: 1_791_547_222_000,
        sessionId,
        summary: "Release plan",
        title: null,
      },
      sessionMessages("interactive_terminal_subagents"),
    );
    memory.subagentTranscripts.set(
      sessionId,
      new Map(
        Object.entries(subagents).map(([agentId, messages]: [string, unknown]) => [
          agentId,
          Array.isArray(messages) ? messages : [],
        ]),
      ),
    );
    const { service } = harness({ store: memory });
    const read = await service.readNativeSession(sessionId);
    const value = read.status === "ok" ? read.value : null;
    const statusOf = (agentId: string): unknown =>
      value?.subagents.find((subagent) => subagent.agentId === agentId)?.turns.at(-1)?.status;
    expect(statusOf("a1b2c3d4e5f600001")).toBe("completed");
    expect(statusOf("a1b2c3d4e5f600003")).toBe("inProgress");
    expect(
      value?.subagents.map((subagent) => [subagent.agentId, subagent.parentToolUseId]),
    ).toEqual([
      ["a1b2c3d4e5f600001", "toolu_bg"],
      ["a1b2c3d4e5f600003", "toolu_open"],
    ]);
  });
});

describe("native session operations over JSON-RPC", () => {
  it("answer with v1 result shapes", async () => {
    const lines: unknown[] = [];
    const { service, rateLimits } = harness({ store: store() });
    const rpc = new RpcServer({
      models: new ModelCatalog(),
      logger: createMemoryLogger(),
      rateLimits,
      runtime: scriptedRuntime().runtime,
      service,
      version: "0.1.0",
      write: (line) => {
        lines.push(JSON.parse(line));
      },
    });
    await rpc.handleLine(
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: {
          client: { name: "t", version: "0" },
          protocol: "codewide-agent",
          protocolVersion: 1,
        },
      }),
    );
    await rpc.handleLine(JSON.stringify({ id: 2, method: "nativeSession.list", params: list }));
    expect(checkMessage(lines.at(-1), "nativeSession.list")).toEqual([]);
    await rpc.handleLine(
      JSON.stringify({ id: 3, method: "nativeSession.read", params: { sessionId: TERMINAL } }),
    );
    expect(checkMessage(lines.at(-1), "nativeSession.read")).toEqual([]);
  });
});

describe("native session CodeWide metadata and provenance", () => {
  it("carries the thread's list metadata and keeps tombstoned sessions flagged", async () => {
    const memory = store();
    memory.remove = async () => Promise.reject(new Error("session file is busy"));
    const { service, logs } = harness({ store: memory });
    await service.update(TERMINAL, { archived: true, type: "archived" });
    await service.update(PROGRAMMATIC, { type: "deleted" });
    expect(logs.some((line) => line.includes('"msg":"claude session could not be deleted"'))).toBe(
      true,
    );
    const result = await service.nativeSessions(list);
    const byId = new Map(
      result.status === "ok"
        ? result.value.sessions.map((session) => [session.sessionId, session])
        : [],
    );
    expect(byId.get(TERMINAL)?.codewide).toEqual({
      createdAt: 1_791_542_431,
      cwd: "/workspace",
      origin: "external",
      presence: { archived: true, type: "listed" },
      recencyAt: null,
      settings: {
        effort: null,
        // The model the terminal session last answered with, not `default`.
        model: "claude-haiku-4-5-20251001",
        permissionProfile: ":read-only",
        serviceTier: null,
      },
      title: { type: "none" },
      updatedAt: 1_791_542_553,
    });
    expect(byId.get(PROGRAMMATIC)?.codewide?.presence).toEqual({
      deletedAt: 1_760_000_000,
      type: "deleted",
    });
  });

  it("describes a CodeWide thread and omits the metadata for untouched sessions", async () => {
    const { service, queries } = harness({ store: store() });
    createThread(service);
    await service.update(THREAD, { name: "Early", type: "name" });
    startedTurn(await service.startTurn(THREAD, prompt("hello")));
    queries[0]?.push(frames.result());
    await settle();
    const result = await service.nativeSessions({ ...list, dir: "/workspace" });
    const sessions = result.status === "ok" ? result.value.sessions : [];
    expect(sessions.find((session) => session.sessionId === THREAD)?.codewide).toMatchObject({
      cwd: "/workspace",
      origin: "interactive",
      presence: { archived: false, type: "listed" },
      settings: { model: "sonnet", permissionProfile: ":workspace" },
      title: { name: "Early", type: "pending" },
    });
    expect(sessions.find((session) => session.sessionId === TERMINAL)).not.toHaveProperty(
      "codewide",
    );
  });

  it("stamps every turn and item with the thread's provenance, live and read", async () => {
    const { service, events, queries } = harness({ store: store() });
    const origin = { nativeThreadId: TERMINAL, provider: "claude" };
    const read = await service.readNativeSession(TERMINAL);
    const turns = read.status === "ok" ? read.value.turns : [];
    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) {
      expect(turn.provenance).toEqual(origin);
      for (const item of turn.items) expect(item.provenance).toEqual(origin);
    }
    createThread(service);
    startedTurn(await service.startTurn(THREAD, prompt("hello")));
    queries[0]?.push(frames.text("m1", "hi"));
    queries[0]?.push(frames.result());
    await settle();
    const stamped = events.flatMap((event) => {
      if (event.type === "turn.started" || event.type === "turn.completed")
        return [event.turn.provenance];
      if (event.type === "item.started" || event.type === "item.completed")
        return [event.item.provenance];
      return [];
    });
    expect(stamped.length).toBeGreaterThan(0);
    expect(new Set(stamped.map((value) => JSON.stringify(value)))).toEqual(
      new Set([JSON.stringify({ nativeThreadId: THREAD, provider: "claude" })]),
    );
  });

  it("reads a replacement session as its own share of the thread", async () => {
    const memory = store();
    const { service, queries } = harness({ store: memory });
    createThread(service);
    const first = startedTurn(await service.startTurn(THREAD, prompt("first question")));
    queries[0]?.push(frames.init);
    queries[0]?.push(frames.text("m1", "first answer"));
    queries[0]?.push(frames.result());
    await settle();
    const second = startedTurn(await service.startTurn(THREAD, prompt("second question")));
    queries[0]?.push(
      frames.result({
        errors: ["No conversation found with session ID x"],
        is_error: true,
        subtype: "error_during_execution",
      }),
    );
    await settle();
    await settle();
    const replacement = queries[1]?.options.identity.sessionId ?? "";
    expect(replacement).not.toBe(THREAD);
    queries[1]?.push(frames.init);
    queries[1]?.push(frames.text("m2", "second answer"));
    queries[1]?.push(frames.result());
    await settle();
    const own = await service.readNativeSession(replacement);
    expect(own.status === "ok" ? own.value.session.appThreadId : null).toBe(THREAD);
    const turns = own.status === "ok" ? own.value.turns : [];
    expect(turns.map((turn) => turn.turnId)).toEqual([second]);
    expect(turns.map((turn) => turn.turnId)).not.toContain(first);
    const texts = turns.flatMap((turn) =>
      turn.items.flatMap((item) => (item.type === "userMessage" ? item.content : [])),
    );
    expect(texts).toEqual([{ text: "second question", type: "text" }]);
  });
});
