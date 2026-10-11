import { describe, expect, it } from "vitest";

import { threadLiveActivityLabel } from "../src/features/threadList/threadLiveActivityLabel";

describe("thread live activity label", () => {
  it("describes each activity in one short line", () => {
    expect(threadLiveActivityLabel({ kind: "reasoning", title: "Inspecting tests" })).toBe(
      "Inspecting tests",
    );
    expect(threadLiveActivityLabel({ kind: "planStep", step: "Fixing the parser" })).toBe(
      "Fixing the parser",
    );
    expect(threadLiveActivityLabel({ command: "cargo test", kind: "command" })).toBe(
      "Running cargo test",
    );
    expect(threadLiveActivityLabel({ kind: "fileEdit", more: 2, path: "crates/core/src/vcs.rs" })).toBe(
      "Editing vcs.rs (+2)",
    );
    expect(threadLiveActivityLabel({ kind: "fileEdit", more: 0, path: "C:\\repo\\main.ts" })).toBe(
      "Editing main.ts",
    );
    expect(threadLiveActivityLabel({ kind: "tool", server: null, tool: "Read" })).toBe("Using Read");
    expect(threadLiveActivityLabel({ kind: "tool", server: "github", tool: "search" })).toBe(
      "Using search (github)",
    );
    expect(threadLiveActivityLabel({ kind: "webSearch" })).toBe("Searching the web");
    expect(threadLiveActivityLabel({ kind: "compacting" })).toBe("Compacting context");
  });
});
