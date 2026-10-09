/**
 * Session lifecycle contracts: busy start, explicit steer, bounded
 * interrupt, idle release, settings at turn boundaries, process loss and
 * restart finalization.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { asTurnId } from "../src/protocol.js";
import type { AgentEvent, TurnId } from "../src/protocol.js";
import { createThread, frames, harness, OTHER_THREAD, settle, THREAD } from "./support/scripted.js";

const text = (value: string) => [{ type: "text" as const, text: value }];

function startedTurn(result: { status: string; value?: unknown }): TurnId {
  const value = result.value as { type: string; turnId?: TurnId } | undefined; // WHY: narrowing a test-only operation result.
  if (result.status !== "ok" || value?.type !== "started" || value.turnId === undefined) throw new Error("turn did not start");
  return value.turnId;
}

const completions = (events: readonly AgentEvent[]) =>
  events.flatMap((event) => (event.type === "turn.completed" ? [event] : []));

afterEach(() => {
  vi.useRealTimers();
});

describe("turn.start", () => {
  it("answers busy with the active turn instead of steering", async () => {
    const { service, queries } = harness();
    createThread(service);
    const turnId = startedTurn(service.startTurn(THREAD, null, text("first")));
    const second = service.startTurn(THREAD, null, text("second"));
    expect(second).toEqual({ status: "ok", value: { type: "busy", activeTurnId: turnId } });
    expect(queries[0]?.offers).toHaveLength(1);
    expect(queries[0]?.offers[0]?.priority).toBeNull();
    await settle();
  });

  it("opens with the session id first and resumes afterwards", async () => {
    const { service, queries } = harness();
    createThread(service);
    startedTurn(service.startTurn(THREAD, null, text("first")));
    queries[0]?.push(frames.init);
    queries[0]?.push(frames.result());
    await settle();
    queries[0]?.end();
    await settle();
    startedTurn(service.startTurn(THREAD, null, text("second")));
    expect(queries.map((query) => query.options.identity)).toEqual([
      { type: "new", sessionId: THREAD },
      { type: "resume", sessionId: THREAD },
    ]);
  });
});

describe("turn.steer", () => {
  it("rejects a mismatched expected turn and offers a matching steer with priority now", async () => {
    const { service, queries } = harness();
    createThread(service);
    const turnId = startedTurn(service.startTurn(THREAD, null, text("first")));
    expect(service.steer(THREAD, asTurnId("other"), null, text("x"))).toEqual({
      status: "error",
      code: -32600,
      message: "expected turn is not active",
    });
    expect(service.steer(THREAD, turnId, null, text("also"))).toEqual({ status: "ok", value: { turnId } });
    const steer = queries[0]?.offers[1];
    expect(steer?.priority).toBe("now");
    expect(steer?.uuid).not.toBeNull();
    // The aborted result caused by the steer does not end the turn.
    queries[0]?.push(frames.result({ subtype: "error_during_execution", is_error: true, terminal_reason: "aborted_streaming" }));
    await settle();
    expect(service.read(THREAD)).toMatchObject({ value: { activeTurnId: turnId } });
    queries[0]?.push(frames.result());
    await settle();
    expect(service.read(THREAD)).toMatchObject({ value: { activeTurnId: null } });
  });
});

describe("turn.interrupt", () => {
  it("answers at once in every state and errors only for a foreign turn while active", async () => {
    const { service, queries, events } = harness({ interruptTimeoutMs: 50 });
    createThread(service);
    expect(service.interrupt(THREAD, null)).toEqual({ status: "ok", value: {} });
    const first = startedTurn(service.startTurn(THREAD, null, text("one")));
    queries[0]?.push(frames.result());
    await settle();
    expect(service.interrupt(THREAD, first)).toEqual({ status: "ok", value: {} });

    const second = startedTurn(service.startTurn(THREAD, null, text("two")));
    expect(service.interrupt(THREAD, asTurnId("foreign"))).toMatchObject({ status: "error", code: -32600 });
    expect(service.interrupt(THREAD, first)).toEqual({ status: "ok", value: {} });
    const started = Date.now();
    expect(service.interrupt(THREAD, second)).toEqual({ status: "ok", value: {} });
    expect(service.interrupt(THREAD, second)).toEqual({ status: "ok", value: {} });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(queries[0]?.interrupts).toBe(1);

    queries[0]?.push(frames.result({ subtype: "success", terminal_reason: "aborted_streaming" }));
    await settle();
    expect(completions(events).map((event) => event.turn.status)).toEqual(["completed", "interrupted"]);
    expect(queries[0]?.closed).toBe(false);
    expect(service.interrupt(THREAD, second)).toEqual({ status: "ok", value: {} });
    expect(service.interrupt("unknown", null)).toMatchObject({ status: "error", code: -32600 });
  });

  it("closes the session and finalizes the turn when no aborted result arrives", async () => {
    const { service, queries, events } = harness({ interruptTimeoutMs: 30 });
    createThread(service);
    const turnId = startedTurn(service.startTurn(THREAD, null, text("long")));
    queries[0]?.push(frames.toolUse("m1", "toolu_1", "Bash", { command: "sleep 100" }));
    await settle();
    service.interrupt(THREAD, turnId);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const completed = completions(events);
    expect(completed.map((event) => event.turn.status)).toEqual(["interrupted"]);
    expect(completed[0]?.turn.items.map((item) => ("status" in item ? item.status : item.type))).toEqual(["userMessage", "failed"]);
    expect(queries[0]?.closed).toBe(true);
    expect(service.read(THREAD)).toMatchObject({ value: { thread: { status: "notLoaded" }, activeTurnId: null } });
  });

  it("resolves an open approval before turn.completed", async () => {
    const { service, queries, events } = harness({ interruptTimeoutMs: 30 });
    createThread(service);
    const turnId = startedTurn(service.startTurn(THREAD, null, text("edit")));
    const decision = queries[0]?.options.canUseTool({
      toolName: "Bash",
      input: { command: "rm x" },
      toolUseId: "toolu_rm",
      suggestions: [],
      decisionReason: null,
      signal: new AbortController().signal,
    });
    await settle();
    service.interrupt(THREAD, turnId);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(decision).resolves.toMatchObject({ behavior: "deny", interrupt: true });
    const types = events.map((event) => event.type);
    expect(types.indexOf("request.resolved")).toBeLessThan(types.indexOf("turn.completed"));
  });
});

describe("idle release", () => {
  it("releases an idle process after the configured time, not while a request is pending", async () => {
    vi.useFakeTimers();
    const { service, queries, logs } = harness({ idleReleaseMs: 1000 });
    createThread(service);
    startedTurn(service.startTurn(THREAD, null, text("hi")));
    queries[0]?.push(frames.result());
    await vi.advanceTimersByTimeAsync(10);
    expect(queries[0]?.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(queries[0]?.closed).toBe(true);
    expect(logs.some((line) => line.includes('"msg":"claude session released"') && line.includes('"liveSessions":0'))).toBe(true);
  });

  it("defers release while background tasks run", async () => {
    vi.useFakeTimers();
    const { service, queries, clock } = harness({ idleReleaseMs: 1000 });
    createThread(service);
    startedTurn(service.startTurn(THREAD, null, text("hi")));
    queries[0]?.push(frames.background(1));
    queries[0]?.push(frames.result());
    await vi.advanceTimersByTimeAsync(10);
    clock.now += 2000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(queries[0]?.closed).toBe(false);
    clock.now += 5 * 60 * 60 * 1000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(queries[0]?.closed).toBe(true);
  });
});

describe("settings", () => {
  it("applies a settings change at the next turn boundary and reopens with resume", async () => {
    const { service, queries, events } = harness();
    createThread(service);
    startedTurn(service.startTurn(THREAD, null, text("hi")));
    queries[0]?.push(frames.init);
    await settle();
    const updated = service.update(THREAD, { type: "settings", model: "opus", effort: "high", permissionProfile: null, serviceTier: null });
    expect(updated.status).toBe("ok");
    expect(queries[0]?.closed).toBe(false);
    queries[0]?.push(frames.result());
    await settle();
    expect(queries[0]?.closed).toBe(true);
    const lastThread = events.filter((event) => event.type === "thread.updated").at(-1);
    expect(lastThread?.type === "thread.updated" ? lastThread.thread.settings : null).toMatchObject({ model: "opus", effort: "high" });
    startedTurn(service.startTurn(THREAD, null, text("next")));
    expect(queries[1]?.options).toMatchObject({ model: "opus", effort: "high", identity: { type: "resume" } });
    const before = events.length;
    expect(service.update(THREAD, { type: "settings", model: "opus", effort: null, permissionProfile: null, serviceTier: null }).status).toBe("ok");
    expect(events.length).toBe(before);
  });

  it("rejects an unknown permission profile", () => {
    const { service } = harness();
    createThread(service);
    expect(service.update(THREAD, { type: "settings", model: null, effort: null, permissionProfile: ":plan", serviceTier: null })).toEqual({
      status: "error",
      code: -32602,
      message: "Unsupported permission profile for Claude: :plan",
    });
  });
});

describe("process loss", () => {
  it("fails only the turn of the thread whose process died", async () => {
    const { service, queries, events } = harness();
    createThread(service, THREAD);
    createThread(service, OTHER_THREAD);
    startedTurn(service.startTurn(THREAD, null, text("a")));
    const other = startedTurn(service.startTurn(OTHER_THREAD, null, text("b")));
    queries[0]?.fail(new Error("killed"));
    await settle();
    const failed = completions(events);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.appThreadId).toBe(THREAD);
    expect(failed[0]?.turn.error).toEqual({ kind: "processExited", message: "Claude process exited unexpectedly" });
    expect(service.read(OTHER_THREAD)).toMatchObject({ value: { activeTurnId: other } });
    startedTurn(service.startTurn(THREAD, null, text("again")));
    expect(queries[2]?.options.identity.type).toBe("new");
  });
});

describe("restart", () => {
  it("finalizes a turn left in progress as interrupted", async () => {
    const first = harness();
    createThread(first.service);
    startedTurn(first.service.startTurn(THREAD, null, text("unfinished")));
    first.queries[0]?.push(frames.toolUse("m1", "toolu_1", "Bash", { command: "make" }));
    await settle();
    const second = harness({ journalDirectory: first.journalDirectory });
    const recovered = second.service.load();
    expect(recovered).toHaveLength(1);
    const completed = recovered[0];
    expect(completed?.type).toBe("turn.completed");
    if (completed?.type !== "turn.completed") return;
    expect(completed.turn.status).toBe("interrupted");
    expect(completed.turn.items.map((item) => item.type)).toEqual(["userMessage", "command"]);
    expect(completed.turn.items[1]).toMatchObject({ status: "failed" });
    expect(second.service.load()).toHaveLength(0);
  });
});

describe("approvals", () => {
  it("emits the item before the request and never allows on an error response", async () => {
    const { service, queries, events } = harness();
    createThread(service);
    startedTurn(service.startTurn(THREAD, null, text("edit")));
    const decision = queries[0]?.options.canUseTool({
      toolName: "Edit",
      input: { file_path: "/workspace/a.ts", old_string: "a", new_string: "b" },
      toolUseId: "toolu_e",
      suggestions: [],
      decisionReason: null,
      signal: new AbortController().signal,
    });
    await settle();
    const types = events.map((event) => event.type);
    expect(types.lastIndexOf("item.started")).toBeLessThan(types.indexOf("request.opened"));
    expect(service.respond(THREAD, "perm-toolu_e", { type: "error", message: "client failed" })).toEqual({ status: "ok", value: {} });
    await expect(decision).resolves.toMatchObject({ behavior: "deny" });
    expect(service.respond(THREAD, "perm-toolu_e", { type: "approval", decision: "accept" })).toMatchObject({ status: "error" });
  });

  it("denies non-read tools under :read-only without asking", async () => {
    const { service, queries, events } = harness();
    createThread(service, THREAD, ":read-only");
    startedTurn(service.startTurn(THREAD, null, text("write")));
    expect(queries[0]?.options.profile).toEqual({
      profile: ":read-only",
      permissionMode: "default",
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: {},
      tools: ["Read", "Glob", "Grep", "LS"],
      allowDangerouslySkipPermissions: false,
    });
    const decision = await queries[0]?.options.canUseTool({
      toolName: "mcp__notes__write_note",
      input: { text: "x" },
      toolUseId: "toolu_m",
      suggestions: [],
      decisionReason: null,
      signal: new AbortController().signal,
    });
    expect(decision).toMatchObject({ behavior: "deny", interrupt: false });
    expect(events.some((event) => event.type === "request.opened")).toBe(false);
  });
});
