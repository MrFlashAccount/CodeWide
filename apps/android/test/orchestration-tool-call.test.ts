import { describe, expect, it } from "vitest";

import { orchestrationToolCall } from "../src/features/conversation/protocol/orchestrationToolCall";

const child = "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d81";

function call(tool: string, args: Record<string, unknown>, result: unknown, extra: Record<string, unknown> = {}) {
  return {
    arguments: args,
    contentItems:
      result === null
        ? null
        : [{ type: "inputText", text: typeof result === "string" ? result : JSON.stringify(result) }],
    namespace: null,
    status: "completed",
    success: true,
    tool,
    type: "dynamicToolCall",
    ...extra,
  };
}

describe("orchestration tool calls", () => {
  it("leaves other dynamic tools to the generic card", () => {
    expect(orchestrationToolCall(call("read_file", { path: "a" }, "x"), "completed")).toBeNull();
  });

  it("names the spawned agent, its provider and model and links its thread", () => {
    const spawn = call(
      "codewide_spawn_agent",
      { prompt: "Review the diff", provider: "claude", name: "reviewer" },
      { agentThreadId: child, provider: "claude", model: "claude-sonnet-4-5", status: "running" },
    );
    expect(orchestrationToolCall(spawn, "completed")).toEqual({
      detail: "Review the diff",
      failed: false,
      meta: "claude-sonnet-4-5",
      running: false,
      targetThreadId: child,
      title: "Spawned Claude agent “reviewer”",
    });
    expect(
      orchestrationToolCall({ ...spawn, contentItems: null, status: "inProgress", success: null }, "inProgress"),
    ).toMatchObject({ running: true, targetThreadId: null, title: "Starting Claude agent “reviewer”" });
  });

  it("summarizes wait outcomes with the final message", () => {
    const wait = (result: unknown) =>
      orchestrationToolCall(call("codewide_wait_agent", { agentThreadId: child }, result), "completed");
    expect(wait({ status: "completed", finalMessage: "All tests pass.", turnId: "t1" })).toMatchObject({
      detail: "All tests pass.",
      targetThreadId: child,
      title: "agent 0199a3c4 finished",
    });
    expect(wait({ status: "running" })?.title).toBe("agent 0199a3c4 is still running");
    expect(wait({ status: "failed" })).toMatchObject({ failed: true, title: "agent 0199a3c4 failed" });
    expect(
      orchestrationToolCall(
        call("codewide_wait_agent", { agentThreadId: child }, null, { status: "inProgress", success: null }),
        "inProgress",
      ),
    ).toMatchObject({ running: true, title: "Waiting for agent 0199a3c4" });
  });

  it("describes messages, cancellation, listings and failures", () => {
    expect(
      orchestrationToolCall(
        call("codewide_send_agent", { agentThreadId: child, message: "Also check lint", mode: "steer" }, { status: "running" }),
        "completed",
      ),
    ).toMatchObject({ detail: "Also check lint", title: "Steered agent 0199a3c4" });
    expect(
      orchestrationToolCall(call("codewide_cancel_agent", { agentThreadId: child }, { status: "interrupted" }), "completed")
        ?.title,
    ).toBe("Cancelled agent 0199a3c4");
    expect(
      orchestrationToolCall(
        call("codewide_list_agents", {}, {
          agents: [
            { agentThreadId: child, provider: "codex", model: "gpt-5.5", name: "reviewer", status: "running" },
            { agentThreadId: "x", provider: "claude", model: "m", name: null, status: "completed" },
          ],
        }),
        "completed",
      ),
    ).toMatchObject({
      detail: "reviewer · Codex · running, agent x · Claude · completed",
      targetThreadId: null,
      title: "Listed 2 agents",
    });
    expect(
      orchestrationToolCall(
        call("codewide_wait_agent", { agentThreadId: child }, "agent not found", { status: "failed", success: false }),
        "failed",
      ),
    ).toEqual({
      detail: "agent not found",
      failed: true,
      meta: null,
      running: false,
      targetThreadId: child,
      title: "Could not wait for agent 0199a3c4",
    });
  });
});
