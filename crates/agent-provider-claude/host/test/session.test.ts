/**
 * Session lifecycle contracts: busy start, explicit steer, bounded
 * interrupt, idle release, settings at turn boundaries, process loss and
 * restart finalization.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { asTurnId } from "../src/protocol.js";
import type { AgentEvent } from "../src/protocol.js";
import {
  createThread,
  frames,
  harness,
  OTHER_THREAD,
  prompt,
  settle,
  startedTurn,
  THREAD,
} from "./support/scripted.js";

const completions = (events: readonly AgentEvent[]) =>
  events.flatMap((event) => (event.type === "turn.completed" ? [event] : []));

afterEach(() => {
  vi.useRealTimers();
});

describe("turn.start", () => {
  it("answers busy with the active turn instead of steering", async () => {
    const { service, queries } = harness();
    createThread(service);
    const turnId = startedTurn(await service.startTurn(THREAD, prompt("first")));
    const second = await service.startTurn(THREAD, prompt("second"));
    expect(second).toEqual({ status: "ok", value: { type: "busy", activeTurnId: turnId } });
    expect(queries[0]?.offers).toHaveLength(1);
    expect(queries[0]?.offers[0]?.priority).toBeNull();
    await settle();
  });

  it("opens with the session id first and resumes afterwards", async () => {
    const { service, queries } = harness();
    createThread(service);
    startedTurn(await service.startTurn(THREAD, prompt("first")));
    queries[0]?.push(frames.init);
    queries[0]?.push(frames.result());
    await settle();
    queries[0]?.end();
    await settle();
    startedTurn(await service.startTurn(THREAD, prompt("second")));
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
    const turnId = startedTurn(await service.startTurn(THREAD, prompt("first")));
    expect(await service.steer(THREAD, asTurnId("other"), prompt("x"))).toEqual({
      status: "error",
      code: -32600,
      message: "expected turn is not active",
    });
    expect(await service.steer(THREAD, turnId, prompt("also"))).toEqual({
      status: "ok",
      value: { turnId },
    });
    const steer = queries[0]?.offers[1];
    expect(steer?.priority).toBe("now");
    expect(steer?.uuid).not.toBeNull();
    // The aborted result caused by the steer does not end the turn.
    queries[0]?.push(
      frames.result({
        subtype: "error_during_execution",
        is_error: true,
        terminal_reason: "aborted_streaming",
      }),
    );
    await settle();
    expect(await service.read(THREAD)).toMatchObject({ value: { activeTurnId: turnId } });
    queries[0]?.push(frames.result());
    await settle();
    expect(await service.read(THREAD)).toMatchObject({ value: { activeTurnId: null } });
  });
});

describe("turn.interrupt", () => {
  it("answers at once in every state and errors only for a foreign turn while active", async () => {
    const { service, queries, events } = harness({ interruptTimeoutMs: 50 });
    createThread(service);
    expect(await service.interrupt(THREAD, null)).toEqual({ status: "ok", value: {} });
    const first = startedTurn(await service.startTurn(THREAD, prompt("one")));
    queries[0]?.push(frames.result());
    await settle();
    expect(await service.interrupt(THREAD, first)).toEqual({ status: "ok", value: {} });

    const second = startedTurn(await service.startTurn(THREAD, prompt("two")));
    expect(await service.interrupt(THREAD, asTurnId("foreign"))).toMatchObject({
      status: "error",
      code: -32600,
    });
    expect(await service.interrupt(THREAD, first)).toEqual({ status: "ok", value: {} });
    const started = Date.now();
    expect(await service.interrupt(THREAD, second)).toEqual({ status: "ok", value: {} });
    expect(await service.interrupt(THREAD, second)).toEqual({ status: "ok", value: {} });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(queries[0]?.interrupts).toBe(1);

    queries[0]?.push(frames.result({ subtype: "success", terminal_reason: "aborted_streaming" }));
    await settle();
    expect(completions(events).map((event) => event.turn.status)).toEqual([
      "completed",
      "interrupted",
    ]);
    expect(queries[0]?.closed).toBe(false);
    expect(await service.interrupt(THREAD, second)).toEqual({ status: "ok", value: {} });
    expect(await service.interrupt("unknown", null)).toMatchObject({
      status: "error",
      code: -32600,
    });
  });

  it("closes the session and finalizes the turn when no aborted result arrives", async () => {
    const { service, queries, events } = harness({ interruptTimeoutMs: 30 });
    createThread(service);
    const turnId = startedTurn(await service.startTurn(THREAD, prompt("long")));
    queries[0]?.push(frames.toolUse("m1", "toolu_1", "Bash", { command: "sleep 100" }));
    await settle();
    await service.interrupt(THREAD, turnId);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const completed = completions(events);
    expect(completed.map((event) => event.turn.status)).toEqual(["interrupted"]);
    expect(
      completed[0]?.turn.items.map((item) => ("status" in item ? item.status : item.type)),
    ).toEqual(["userMessage", "failed"]);
    expect(queries[0]?.closed).toBe(true);
    expect(await service.read(THREAD)).toMatchObject({
      value: { thread: { status: "notLoaded" }, activeTurnId: null },
    });
  });

  it("resolves an open approval before turn.completed", async () => {
    const { service, queries, events } = harness({ interruptTimeoutMs: 30 });
    createThread(service);
    const turnId = startedTurn(await service.startTurn(THREAD, prompt("edit")));
    const decision = queries[0]?.options.canUseTool({
      toolName: "Bash",
      input: { command: "rm x" },
      toolUseId: "toolu_rm",
      decisionReason: null,
      signal: new AbortController().signal,
    });
    await settle();
    await service.interrupt(THREAD, turnId);
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
    startedTurn(await service.startTurn(THREAD, prompt("hi")));
    queries[0]?.push(frames.result());
    await vi.advanceTimersByTimeAsync(10);
    expect(queries[0]?.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(queries[0]?.closed).toBe(true);
    expect(
      logs.some(
        (line) =>
          line.includes('"msg":"claude session released"') && line.includes('"liveSessions":0'),
      ),
    ).toBe(true);
  });

  it("defers release while background tasks run", async () => {
    vi.useFakeTimers();
    const { service, queries, clock } = harness({ idleReleaseMs: 1000 });
    createThread(service);
    startedTurn(await service.startTurn(THREAD, prompt("hi")));
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
    startedTurn(await service.startTurn(THREAD, prompt("hi")));
    queries[0]?.push(frames.init);
    await settle();
    const updated = await service.update(THREAD, {
      type: "settings",
      model: "opus",
      effort: "high",
      permissionProfile: null,
      serviceTier: null,
    });
    expect(updated.status).toBe("ok");
    expect(queries[0]?.closed).toBe(false);
    queries[0]?.push(frames.result());
    await settle();
    expect(queries[0]?.closed).toBe(true);
    const lastThread = events.filter((event) => event.type === "thread.updated").at(-1);
    expect(lastThread?.type === "thread.updated" ? lastThread.thread.settings : null).toMatchObject(
      { model: "opus", effort: "high" },
    );
    startedTurn(await service.startTurn(THREAD, prompt("next")));
    expect(queries[1]?.options).toMatchObject({
      model: "opus",
      effort: "high",
      identity: { type: "resume" },
    });
    const before = events.length;
    expect(
      (
        await service.update(THREAD, {
          type: "settings",
          model: "opus",
          effort: null,
          permissionProfile: null,
          serviceTier: null,
        })
      ).status,
    ).toBe("ok");
    expect(events.length).toBe(before);
  });

  const bash = (toolUseId: string) => ({
    toolName: "Bash",
    input: { command: "make" },
    toolUseId,
    decisionReason: null,
    signal: new AbortController().signal,
  });
  const profileChange = (permissionProfile: string) =>
    ({
      type: "settings",
      model: null,
      effort: null,
      permissionProfile,
      serviceTier: null,
    }) as const;
  const lastSettings = (events: readonly AgentEvent[]) => {
    const last = events.filter((event) => event.type === "thread.updated").at(-1);
    return last?.type === "thread.updated" ? last.thread.settings : null;
  };

  it("applies full access to the running turn: no more approval requests", async () => {
    const { service, queries, events } = harness();
    createThread(service);
    startedTurn(await service.startTurn(THREAD, prompt("build")));
    queries[0]?.push(frames.init);
    await settle();
    expect((await service.update(THREAD, profileChange(":full-access"))).status).toBe("ok");
    // Reported at once, not at the turn boundary.
    expect(lastSettings(events)).toMatchObject({ permissionProfile: ":full-access" });
    expect(queries[0]?.closed).toBe(false);
    // A query opened without `allowDangerouslySkipPermissions` cannot enter bypass mode;
    // the host allows instead.
    expect(queries[0]?.modes).toEqual([]);
    const decision = await queries[0]?.options.canUseTool(bash("toolu_full"));
    expect(decision).toMatchObject({ behavior: "allow" });
    expect(events.some((event) => event.type === "request.opened")).toBe(false);
  });

  it("tightens a full-access session live", async () => {
    const { service, queries, events } = harness();
    createThread(service, THREAD, ":full-access");
    startedTurn(await service.startTurn(THREAD, prompt("build")));
    expect(queries[0]?.options.profile.permissionMode).toBe("bypassPermissions");
    expect((await service.update(THREAD, profileChange(":workspace"))).status).toBe("ok");
    expect(queries[0]?.modes).toEqual(["acceptEdits"]);
    void queries[0]?.options.canUseTool(bash("toolu_ws"));
    await settle();
    expect(events.some((event) => event.type === "request.opened")).toBe(true);
    // Back to full access: this query may re-enter bypass mode.
    expect((await service.update(THREAD, profileChange(":full-access"))).status).toBe("ok");
    expect(queries[0]?.modes).toEqual(["acceptEdits", "bypassPermissions"]);
  });

  it("keeps :read-only changes for the next turn boundary", async () => {
    const { service, queries, events } = harness();
    createThread(service);
    startedTurn(await service.startTurn(THREAD, prompt("build")));
    queries[0]?.push(frames.init);
    await settle();
    expect((await service.update(THREAD, profileChange(":read-only"))).status).toBe("ok");
    expect(lastSettings(events)).toMatchObject({ permissionProfile: ":read-only" });
    expect(queries[0]?.modes).toEqual([]);
    void queries[0]?.options.canUseTool(bash("toolu_ro"));
    await settle();
    expect(events.some((event) => event.type === "request.opened")).toBe(true);
    queries[0]?.push(frames.result());
    await settle();
    expect(queries[0]?.closed).toBe(true);
    startedTurn(await service.startTurn(THREAD, prompt("next")));
    expect(queries[1]?.options.profile.profile).toBe(":read-only");
  });

  it("rejects an unknown permission profile", async () => {
    const { service } = harness();
    createThread(service);
    expect(
      await service.update(THREAD, {
        type: "settings",
        model: null,
        effort: null,
        permissionProfile: ":plan",
        serviceTier: null,
      }),
    ).toEqual({
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
    startedTurn(await service.startTurn(THREAD, prompt("a")));
    const other = startedTurn(await service.startTurn(OTHER_THREAD, prompt("b")));
    queries[0]?.fail(new Error("killed"));
    await settle();
    const failed = completions(events);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.appThreadId).toBe(THREAD);
    expect(failed[0]?.turn.error).toEqual({
      kind: "processExited",
      message: "Claude process exited unexpectedly",
    });
    expect(await service.read(OTHER_THREAD)).toMatchObject({ value: { activeTurnId: other } });
    startedTurn(await service.startTurn(THREAD, prompt("again")));
    expect(queries[2]?.options.identity.type).toBe("new");
  });
});

describe("restart", () => {
  it("finalizes a turn left in progress as interrupted", async () => {
    const first = harness();
    createThread(first.service);
    startedTurn(await first.service.startTurn(THREAD, prompt("unfinished")));
    first.queries[0]?.push(frames.toolUse("m1", "toolu_1", "Bash", { command: "make" }));
    await settle();
    const second = harness({ stateDirectory: first.stateDirectory, store: first.store });
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
    startedTurn(await service.startTurn(THREAD, prompt("edit")));
    const decision = queries[0]?.options.canUseTool({
      toolName: "Edit",
      input: { file_path: "/workspace/a.ts", old_string: "a", new_string: "b" },
      toolUseId: "toolu_e",
      decisionReason: null,
      signal: new AbortController().signal,
    });
    await settle();
    const types = events.map((event) => event.type);
    expect(types.lastIndexOf("item.started")).toBeLessThan(types.indexOf("request.opened"));
    expect(
      await service.respond(THREAD, "perm-toolu_e", { type: "error", message: "client failed" }),
    ).toEqual({ status: "ok", value: {} });
    await expect(decision).resolves.toMatchObject({ behavior: "deny" });
    expect(
      await service.respond(THREAD, "perm-toolu_e", { type: "approval", decision: "accept" }),
    ).toMatchObject({ status: "error" });
  });

  it("denies non-read tools under :read-only without asking", async () => {
    const { service, queries, events } = harness();
    createThread(service, THREAD, ":read-only");
    startedTurn(await service.startTurn(THREAD, prompt("write")));
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
      decisionReason: null,
      signal: new AbortController().signal,
    });
    expect(decision).toMatchObject({ behavior: "deny", interrupt: false });
    expect(events.some((event) => event.type === "request.opened")).toBe(false);
  });
});
