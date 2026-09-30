import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");

function download(tamper: boolean) {
  const root = mkdtempSync(join(tmpdir(), "codewide-reuse-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const gh = join(bin, "gh");
    // Exercise the real downloader at its external CLI boundary; the fake only
    // substitutes GitHub's transport, not inventory validation or checksums.
    writeFileSync(
      gh,
      '#!/bin/sh\nprintf "%s\\n" "$3" >> "$CODEWIDE_TEST_GH_LOG"\ncp "$CODEWIDE_TEST_PAYLOAD" "$7/$5"\n',
    );
    chmodSync(gh, 0o755);
    const payload = "previous signed product";
    const source = join(root, "source.bin");
    writeFileSync(source, tamper ? "tampered" : payload);
    const plan = join(root, "plan.json");
    writeFileSync(
      plan,
      JSON.stringify({
        targets: [
          {
            id: "macos",
            version: "0.5.0",
            sourceRevision: "a".repeat(40),
            sourceTag: "release-2026-09-29.2",
            delivery: "reuse",
            assets: [
              {
                name: "CodeWide-0.5.0.dmg",
                sha256: createHash("sha256").update(payload).digest("hex"),
                size: Buffer.byteLength(payload),
              },
            ],
          },
          {
            id: "android-apk",
            version: "0.5.1",
            sourceRevision: "b".repeat(40),
            sourceTag: "release-2026-09-30.1",
            delivery: "build",
          },
        ],
      }),
    );
    const destination = join(root, "download");
    const log = join(root, "requests.log");
    const result = spawnSync(
      process.execPath,
      [join(repoRoot, "scripts/reuse-release-products.ts"), plan, destination],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          CODEWIDE_TEST_PAYLOAD: source,
          CODEWIDE_TEST_GH_LOG: log,
        },
      },
    );
    return {
      status: result.status,
      stderr: result.stderr,
      requests: readFileSync(log, "utf8"),
      payload: readFileSync(join(destination, "CodeWide-0.5.0.dmg"), "utf8"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("finished product reuse", () => {
  it("downloads only reused products from their original release and preserves their bytes", () => {
    expect(download(false)).toMatchObject({
      status: 0,
      requests: "release-2026-09-29.2\n",
      payload: "previous signed product",
    });
  });

  it("rejects transport bytes that no longer match the published inventory", () => {
    const result = download(true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Reused asset checksum mismatch");
  });
});
