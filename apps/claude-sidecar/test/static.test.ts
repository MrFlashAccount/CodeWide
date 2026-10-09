/**
 * Static boundary checks of the sidecar sources:
 * - only `src/claude/sdkRuntime.ts` imports the Agent SDK;
 * - `@codewide/*` packages are imported type-only (dist has none);
 * - `src/mapping/` performs no I/O;
 * - no source reads `ANTHROPIC_*` values or touches `~/.claude`, CODEX_HOME
 *   or state.redb;
 * - the journal writes owner-only files atomically.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal, ZERO_USAGE } from "../src/journal/journal.js";
import { SIDECAR_VERSION } from "../src/version.js";

const root = join(import.meta.dirname, "..");

function files(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const sources = files(join(root, "src")).filter((path) => path.endsWith(".ts"));
/** Whole import/export-from statements (multi-line aware), one string each. */
const importLines = (text: string): readonly string[] =>
  [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["'][^"']+["']|^\s*import\s+["'][^"']+["']/gm)].map((match) => match[0].trim());

/** Source text without comments, for content checks. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("source boundaries", () => {
  it("imports the Agent SDK only from src/claude/sdkRuntime.ts", () => {
    const importers = sources.filter((path) => importLines(readFileSync(path, "utf8")).some((line) => line.includes("@anthropic-ai/claude-agent-sdk")));
    expect(importers.map((path) => relative(root, path))).toEqual(["src/claude/sdkRuntime.ts"]);
  });

  it("imports @codewide packages type-only", () => {
    for (const path of sources) {
      for (const line of importLines(readFileSync(path, "utf8"))) {
        if (line.includes("@codewide/")) expect(line).toMatch(/^(import|export) type\b/);
      }
    }
  });

  it("keeps the mapping layer free of I/O", () => {
    for (const path of sources.filter((value) => value.includes(`${join("src", "mapping")}`))) {
      const imports = importLines(readFileSync(path, "utf8")).join("\n");
      expect(imports).not.toMatch(/node:(fs|child_process|net|os)|sdkRuntime|journal/);
    }
  });

  it("never reads credentials or foreign state", () => {
    for (const path of sources) {
      const text = code(readFileSync(path, "utf8"));
      expect(text).not.toMatch(/ANTHROPIC_/);
      expect(text).not.toMatch(/["'`][^"'`]*\.claude\/[^"'`]*["'`]/);
      expect(text).not.toMatch(/homedir\(/);
      expect(text).not.toMatch(/CODEX_HOME|state\.redb["'`]/);
    }
  });

  it("ships a dist without workspace imports when built", () => {
    for (const path of files(join(root, "dist")).filter((value) => value.endsWith(".js"))) {
      expect(importLines(readFileSync(path, "utf8")).filter((line) => line.includes("@codewide/"))).toEqual([]);
    }
  });
});

describe("host lock", () => {
  it("reports the package.json version", () => {
    expect(SIDECAR_VERSION).toBe(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
  });

  it("pins the host install to the package.json versions", () => {
    expect(execFileSync(process.execPath, [join(root, "scripts", "check-host-lock.mjs")], { encoding: "utf8" })).toContain("matches");
  });
});

describe("journal", () => {
  it("writes owner-only files atomically and reads them back", () => {
    const directory = join(mkdtempSync(join(tmpdir(), "claude-journal-")), "journal");
    const journal = new Journal(directory);
    const record = {
      version: 1 as const,
      appThreadId: "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e",
      claudeSessionId: "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e",
      sessionStarted: false,
      cwd: "/w",
      name: null,
      preview: "",
      firstUserMessage: null,
      createdAt: 1,
      updatedAt: 1,
      recencyAt: null,
      archived: false,
      deletedAt: null,
      settings: { model: "m", effort: null, permissionProfile: ":workspace", serviceTier: null },
      pendingSettings: null,
      totalUsage: ZERO_USAGE,
      turnCount: 0,
    };
    journal.writeThread(record);
    journal.writeThread({ ...record, name: "renamed" });
    const threadDirectory = join(directory, "threads", record.appThreadId);
    expect(readdirSync(threadDirectory)).toEqual(["thread.json"]);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(threadDirectory, "thread.json")).mode & 0o777).toBe(0o600);
    expect(journal.loadThreads(() => {})).toEqual([{ ...record, name: "renamed" }]);
    expect(() => journal.writeThread({ ...record, appThreadId: "../escape" })).toThrow();
  });
});
