import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");

function downloadUrl(installer: "relay" | "companion", version: string): string {
  const root = mkdtempSync(join(tmpdir(), "codewide-install-route-"));
  try {
    const bin = join(root, "bin");
    const log = join(root, "curl.log");
    mkdirSync(bin);
    const curl = join(bin, "curl");
    writeFileSync(curl, '#!/bin/sh\nfor argument do url=$argument; done\nprintf "%s\\n" "$url" > "$CODEWIDE_TEST_CURL_LOG"\nexit 22\n');
    chmodSync(curl, 0o755);
    const args = installer === "companion" ? ["--version", version, "--no-start"] : ["--version", version];
    const result = spawnSync("sh", [join(repoRoot, "install", installer), ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, CODEWIDE_TEST_CURL_LOG: log, TMPDIR: root },
    });
    expect(result.status).not.toBe(0);
    return readFileSync(log, "utf8").trim();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("installer release tags", () => {
  it("resolves historical product tags", () => {
    expect(downloadUrl("relay", "0.3.1")).toContain("/releases/download/relay-v0.3.1/");
    expect(downloadUrl("companion", "0.4.0")).toContain("/releases/download/companion-linux-v0.4.0/");
  });

  it("resolves combined release tags", () => {
    expect(downloadUrl("relay", "0.4.1")).toContain("/releases/download/v0.4.1/");
    expect(downloadUrl("companion", "0.4.1")).toContain("/releases/download/v0.4.1/");
  });
});
