import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveDefaultTokenPath } from "../src/state-paths";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })));
});

describe("host state path compatibility", () => {
  it("uses a legacy token until the CodeWide state migration runs", async () => {
    const home = path.join(tmpdir(), `codewide-state-paths-${process.pid}-${Date.now()}`);
    roots.push(home);
    await mkdir(path.join(home, ".codex-remote"), { recursive: true });
    await writeFile(path.join(home, ".codex-remote", "host.token"), "legacy");
    expect(resolveDefaultTokenPath(home)).toBe(path.join(home, ".codex-remote", "host.token"));

    await mkdir(path.join(home, ".codewide"), { recursive: true });
    await writeFile(path.join(home, ".codewide", "host.token"), "current");
    expect(resolveDefaultTokenPath(home)).toBe(path.join(home, ".codewide", "host.token"));
  });
});
