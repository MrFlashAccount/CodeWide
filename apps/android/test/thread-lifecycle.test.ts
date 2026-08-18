import { describe, expect, it } from "vitest";

import { effectiveTurnLifecycleStatus, isThreadLifecycleActive } from "../src/data/thread-lifecycle";

describe("thread lifecycle presentation", () => {
  it("treats running and approval summaries as live", () => {
    expect(isThreadLifecycleActive("running")).toBe(true);
    expect(isThreadLifecycleActive("approval")).toBe(true);
    expect(isThreadLifecycleActive(undefined)).toBe(false);
  });

  it("does not present stale detail as running after the summary is terminal", () => {
    expect(effectiveTurnLifecycleStatus("inProgress", undefined)).toBe("completed");
    expect(effectiveTurnLifecycleStatus("inProgress", "failed")).toBe("failed");
  });

  it("preserves live and already terminal detail statuses", () => {
    expect(effectiveTurnLifecycleStatus("inProgress", "running")).toBe("inProgress");
    expect(effectiveTurnLifecycleStatus("inProgress", "approval")).toBe("inProgress");
    expect(effectiveTurnLifecycleStatus("interrupted", undefined)).toBe("interrupted");
  });
});
