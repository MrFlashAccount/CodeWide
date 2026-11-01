import { describe, expect, it } from "vitest";

import {
  advanceBackgroundCommand,
  parseBackgroundCommand,
  reconcileBackgroundCommand,
} from "../src/index";

describe("background command marker", () => {
  it("accepts each state with exactly the fields that state carries", () => {
    expect(
      parseBackgroundCommand({ description: "Run it", startedAt: 3, status: "running", taskId: "b1" }),
    ).toEqual({ description: "Run it", startedAt: 3, status: "running", taskId: "b1" });
    expect(
      parseBackgroundCommand({ endedAt: 5, exitCode: null, status: "failed", taskId: "b1" }),
    ).toEqual({
      description: null,
      endedAt: 5,
      exitCode: null,
      startedAt: null,
      status: "failed",
      taskId: "b1",
    });
    expect(parseBackgroundCommand({ endedAt: 5, status: "stopped", taskId: "b1" })).toEqual({
      description: null,
      endedAt: 5,
      startedAt: null,
      status: "stopped",
      taskId: "b1",
    });
  });

  it("rejects an ended state without its end, an invalid exit code or an unknown status", () => {
    expect(parseBackgroundCommand({ exitCode: 0, status: "completed", taskId: "b1" })).toBeNull();
    expect(
      parseBackgroundCommand({ endedAt: 5, exitCode: 1.5, status: "completed", taskId: "b1" }),
    ).toBeNull();
    expect(parseBackgroundCommand({ endedAt: 5, status: "killed", taskId: "b1" })).toBeNull();
    expect(parseBackgroundCommand({ status: "running", taskId: "" })).toBeNull();
    expect(parseBackgroundCommand("b1")).toBeNull();
  });

  it("never moves an ended state back", () => {
    const task = { description: null, startedAt: 1, taskId: "b1" } as const;
    const ended = { ...task, endedAt: 5, exitCode: 0, status: "completed" } as const;
    const running = { ...task, status: "running" } as const;
    expect(advanceBackgroundCommand(null, running)).toBe(running);
    expect(advanceBackgroundCommand(running, ended)).toBe(ended);
    expect(advanceBackgroundCommand(ended, running)).toBe(ended);
    expect(advanceBackgroundCommand(ended, { ...task, endedAt: 6, status: "stopped" })).toBe(ended);
  });

  it("lets an authoritative read's end win but never reopen an end", () => {
    const task = { description: null, startedAt: 1, taskId: "b1" } as const;
    const running = { ...task, status: "running" } as const;
    const local = { ...task, endedAt: 5, exitCode: null, status: "completed" } as const;
    const read = { ...task, endedAt: 6, exitCode: null, status: "completed" } as const;
    expect(reconcileBackgroundCommand(running, read)).toBe(read);
    expect(reconcileBackgroundCommand(local, read)).toBe(read);
    expect(reconcileBackgroundCommand(local, running)).toBe(local);
    expect(reconcileBackgroundCommand(null, running)).toBe(running);
  });
});
