import { describe, expect, it, vi } from "vitest";

import { firstPageFailure } from "../src/features/pullRequestDetail/changes/filesFailure";

const failure = { kind: "contractViolation", message: "The companion sent an invalid files page result" } as const;

describe("Changes first files page failure", () => {
  it("reports a failed first page with its retry instead of an endless skeleton", () => {
    const retry = vi.fn();
    const shown = firstPageFailure({ failure, status: "failed", value: null }, retry);
    expect(shown?.message).toBe(failure.message);
    shown?.retry();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps already shown files when a later refresh fails", () => {
    expect(firstPageFailure({ failure, status: "failed", value: { files: [] } }, vi.fn())).toBeNull();
  });

  it("reports nothing while the first page loads", () => {
    expect(firstPageFailure({ status: "loading", value: null }, vi.fn())).toBeNull();
    expect(firstPageFailure({ status: "idle" }, vi.fn())).toBeNull();
  });
});
