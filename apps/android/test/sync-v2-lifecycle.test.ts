import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("legacy workspace Sync V2 canary removal", () => {
  it("removes the platform lifecycle files and every legacy workspace lifecycle hook", () => {
    expect(existsSync(new URL("../src/native/sync-v2-lifecycle.native.ts", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/native/sync-v2-lifecycle.web.ts", import.meta.url))).toBe(false);

    const workspace = source("../src/data/use-remote-workspace.ts");
    expect(workspace).not.toContain("sync-v2-lifecycle");
    expect(workspace).not.toContain("syncV2Lifecycle");
    expect(workspace).not.toContain("createNativeSyncV2Lifecycle");
  });
});
