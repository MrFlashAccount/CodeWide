import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");

/** Reads the repository's literal shell step, not a second version resolver. */
function resolveVersionShell(): string {
  const lines = readFileSync(join(repoRoot, ".github/workflows/macos-release.yml"), "utf8").split(
    "\n",
  );
  const step = lines.findIndex((line) => line.trim() === "- name: Resolve version");
  if (step < 0) throw new Error("macOS version resolution step is missing");
  let run = step + 1;
  while (run < lines.length && lines[run]?.trim() !== "run: |") {
    if (lines[run]?.trim().startsWith("- name:"))
      throw new Error("Version resolution needs a literal shell step");
    run += 1;
  }
  const runLine = lines[run];
  if (runLine === undefined) throw new Error("Version resolution shell is missing");
  const indentation = runLine.length - runLine.trimStart().length + 2;
  const content: string[] = [];
  for (let index = run + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.trim().length === 0) {
      content.push("");
      continue;
    }
    if (line.length - line.trimStart().length < indentation) break;
    content.push(line.slice(indentation));
  }
  if (content.length === 0) throw new Error("Version resolution shell is empty");
  return content.join("\n");
}

type ResolutionInput = {
  readonly requested: string;
  readonly bump: string;
  readonly previous: string;
  readonly tag: string;
};

function resolveVersion(input: ResolutionInput) {
  const root = mkdtempSync(join(tmpdir(), "codewide-macos-version-"));
  const output = join(root, "github-env");
  try {
    const result = spawnSync("bash", ["-e", "-c", resolveVersionShell()], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        RAW_VERSION: input.requested,
        VERSION_BUMP: input.bump,
        CODEWIDE_PREVIOUS_MACOS_VERSION: input.previous,
        REQUESTED_RELEASE_TAG: input.tag,
        GITHUB_ENV: output,
      },
    });
    return {
      status: result.status,
      stderr: result.stderr,
      environment:
        result.status === 0
          ? Object.fromEntries(
              readFileSync(output, "utf8")
                .trim()
                .split("\n")
                .map((line) => {
                  const separator = line.indexOf("=");
                  return [line.slice(0, separator), line.slice(separator + 1)];
                }),
            )
          : {},
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("actual macOS Resolve version workflow shell", () => {
  it.each([
    { requested: "0.5.0", bump: "", previous: "0.4.0", expected: "0.5.0", build: "200000.5.0" },
    { requested: "", bump: "minor", previous: "0.4.0", expected: "0.5.0", build: "200000.5.0" },
    { requested: "0.10.0", bump: "", previous: "0.9.99", expected: "0.10.0", build: "200000.10.0" },
    { requested: "1.0.0", bump: "", previous: "0.99.99", expected: "1.0.0", build: "200001.0.0" },
  ])(
    "resolves $requested/$bump after $previous without treating dotted builds as integers",
    (input) => {
      const tag = "release-2026-09-30.1";
      const result = resolveVersion({
        requested: input.requested,
        bump: input.bump,
        previous: input.previous,
        tag,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.environment).toEqual({
        CODEWIDE_VERSION: input.expected,
        CODEWIDE_BUILD_NUMBER: input.build,
        RELEASE_TAG: tag,
        DMG_PATH: `apps/companion-macos/dist/CodeWide-${input.expected}.dmg`,
        APPCAST_PATH: "apps/companion-macos/dist/appcast.xml",
      });
    },
  );

  it("keeps standalone version-tag publication available", () => {
    const result = resolveVersion({ requested: "", bump: "patch", previous: "0.5.0", tag: "" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.environment.RELEASE_TAG).toBe("v0.5.1");
  });

  it.each(["0.4.0", "0.3.99"])(
    "rejects repeated or lower version %s without publishing environment",
    (requested) => {
      const result = resolveVersion({
        requested,
        bump: "",
        previous: "0.4.0",
        tag: "release-2026-09-30.1",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("must be newer");
      expect(result.environment).toEqual({});
    },
  );

  it("rejects prereleases outside the declared stable release contract", () => {
    const result = resolveVersion({
      requested: "0.5.0-beta.1",
      bump: "",
      previous: "0.4.0",
      tag: "release-2026-09-30.1",
    });
    expect(result.status).not.toBe(0);
  });
});
