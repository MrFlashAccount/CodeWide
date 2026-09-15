import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  shouldRepairThreadDetail,
  threadPatchRequiresAuthoritativeRefresh,
} from "../src/data/thread-detail-refresh-policy";

const remoteWorkspace = readFileSync(
  new URL("../src/data/thread-sync-runtime.ts", import.meta.url),
  "utf8",
);

describe("thread detail refresh policy", () => {
  it("refreshes an invalidation for the retained conversation", () => {
    expect(shouldRepairThreadDetail("visible-thread", "visible-thread")).toBe(true);
  });

  it("defers background conversation detail until it becomes retained", () => {
    expect(shouldRepairThreadDetail("visible-thread", "background-thread")).toBe(false);
    expect(shouldRepairThreadDetail(undefined, "background-thread")).toBe(false);
  });

  it("uses rollout invalidation as fallback instead of rereading after live completion", () => {
    expect(threadPatchRequiresAuthoritativeRefresh("threadInvalidated")).toBe(true);
    expect(threadPatchRequiresAuthoritativeRefresh("turnCompleted")).toBe(false);
  });

  it("keeps observation separate from authoritative window hydration", () => {
    const observer = remoteWorkspace.slice(
      remoteWorkspace.indexOf("const observeThread ="),
      remoteWorkspace.indexOf("const readThread ="),
    );

    expect(observer).toContain("threadObserverDesired.set(connectionId, threadId)");
    expect(observer).not.toContain("readThread(");
  });
});
