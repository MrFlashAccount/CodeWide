import { describe, expect, it } from "vitest";

import { threadLiveActivityLabel } from "../src/features/threadList/threadLiveActivityLabel";

describe("thread live activity label", () => {
  it("describes reasoning and plan steps in one short line", () => {
    expect(threadLiveActivityLabel({ kind: "reasoning", title: "Inspecting tests" })).toBe(
      "Inspecting tests",
    );
    expect(threadLiveActivityLabel({ kind: "planStep", step: "Fixing the parser" })).toBe(
      "Fixing the parser",
    );
  });

  it("leaves mechanical steps to the preview", () => {
    expect(threadLiveActivityLabel({ command: "cargo test", kind: "command" })).toBeNull();
    expect(
      threadLiveActivityLabel({ kind: "fileEdit", more: 2, path: "crates/core/src/vcs.rs" }),
    ).toBeNull();
    expect(threadLiveActivityLabel({ kind: "tool", server: "github", tool: "search" })).toBeNull();
    expect(threadLiveActivityLabel({ kind: "webSearch" })).toBeNull();
    expect(threadLiveActivityLabel({ kind: "compacting" })).toBeNull();
  });
});
