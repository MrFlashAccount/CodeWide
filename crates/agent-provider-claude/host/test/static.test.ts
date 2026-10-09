/**
 * Static boundary checks of the Claude agent host sources:
 * - only the SDK adapters (`src/claude/sdkRuntime.ts`, `sdkSessionStore.ts`,
 *   `sdkClientTools.ts`) import the Agent SDK;
 * - `@codewide/*` packages are imported type-only (dist has none);
 * - `src/mapping/` performs no I/O;
 * - no source reads `ANTHROPIC_*` values or touches `~/.claude`, CODEX_HOME
 *   or state.redb;
 * - the thread state store writes owner-only files atomically and keeps
 *   no conversation content;
 * - `src/history/` is pure like `src/mapping/`.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ThreadStateStore } from "../src/state/stateStore.js";
import { ZERO_USAGE, type ThreadState } from "../src/state/threadState.js";
import { HOST_VERSION } from "../src/version.js";

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
  [
    ...text.matchAll(
      /^\s*(?:import|export)\b[^;]*?\bfrom\s+["'][^"']+["']|^\s*import\s+["'][^"']+["']/gm,
    ),
  ].map((match) => match[0].trim());

/** Source text without comments, for content checks. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("source boundaries", () => {
  it("imports the Agent SDK only from the SDK adapters", () => {
    const importers = sources.filter((path) =>
      importLines(readFileSync(path, "utf8")).some((line) =>
        line.includes("@anthropic-ai/claude-agent-sdk"),
      ),
    );
    expect(importers.map((path) => relative(root, path)).toSorted()).toEqual([
      "src/claude/sdkClientTools.ts",
      "src/claude/sdkRuntime.ts",
      "src/claude/sdkSessionStore.ts",
    ]);
  });

  it("imports @codewide packages type-only", () => {
    for (const path of sources) {
      for (const line of importLines(readFileSync(path, "utf8"))) {
        if (line.includes("@codewide/")) expect(line).toMatch(/^(import|export) type\b/);
      }
    }
  });

  it("keeps the mapping and history layers free of I/O", () => {
    const pure = sources.filter(
      (value) => value.includes(join("src", "mapping")) || value.includes(join("src", "history")),
    );
    expect(pure.length).toBeGreaterThan(0);
    for (const path of pure) {
      const imports = importLines(readFileSync(path, "utf8")).join("\n");
      expect(imports).not.toMatch(
        /node:(fs|child_process|net|os)|sdkRuntime|sdkSessionStore|stateStore|threads\/(service|session|registry|prompt)/,
      );
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
      expect(
        importLines(readFileSync(path, "utf8")).filter((line) => line.includes("@codewide/")),
      ).toEqual([]);
    }
  });
});

describe("install lock", () => {
  it("reports the package.json version", () => {
    expect(HOST_VERSION).toBe(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
  });

  it("pins the installed dependencies to the package.json versions", () => {
    expect(
      execFileSync(process.execPath, [join(root, "scripts", "checkInstallLock.mjs")], {
        encoding: "utf8",
      }),
    ).toContain("matches");
  });
});

describe("thread state store", () => {
  it("writes owner-only files atomically and reads them back", () => {
    const directory = join(mkdtempSync(join(tmpdir(), "claude-agent-host-state-")), "state");
    const store = new ThreadStateStore(directory);
    const state: ThreadState = {
      appThreadId: "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e",
      createdAt: 1,
      cwd: "/w",
      origin: "created",
      pendingSettings: null,
      presence: { archived: false, type: "listed" },
      recencyAt: null,
      sessionIds: ["0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7e"],
      sessionStarted: false,
      settings: { effort: null, model: "m", permissionProfile: ":workspace", serviceTier: null },
      title: { type: "none" },
      totalCost: { type: "known", usd: 0.25 },
      totalUsage: { ...ZERO_USAGE, cacheWriteInputTokens: 7, inputTokens: 10, totalTokens: 10 },
      turns: [
        {
          anchors: ["anchor"],
          completedAt: 2,
          origin: "user",
          outcome: { status: "completed" },
          prompts: [{ clientMessageId: null, role: "first", uuid: "anchor" }],
          startedAt: 1,
          turnId: "turn",
          usage: {
            contextWindow: 200_000,
            cost: { basis: "list", model: "claude-sonnet-4-6", threadUsd: 0.25, turnUsd: 0.25 },
            last: ZERO_USAGE,
            total: ZERO_USAGE,
            turn: ZERO_USAGE,
          },
        },
      ],
      updatedAt: 1,
      usageBaseline: {
        checkpoints: [
          [
            {
              cacheCreationInputTokens: 7,
              cacheReadInputTokens: 0,
              costUsd: 0.25,
              inputTokens: 3,
              model: "claude-sonnet-4-6",
              outputTokens: 0,
              thinkingTokens: 0,
            },
          ],
        ],
        type: "known",
      },
      version: 2,
    };
    store.write(state);
    store.write({ ...state, title: { name: "renamed", type: "pending" } });
    const threadDirectory = join(directory, "threads", state.appThreadId);
    expect(readdirSync(threadDirectory)).toEqual(["state.json"]);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(threadDirectory, "state.json")).mode & 0o777).toBe(0o600);
    expect(store.load(() => {})).toEqual([
      { activeTurn: null, state: { ...state, title: { name: "renamed", type: "pending" } } },
    ]);
    expect(() => store.write({ ...state, appThreadId: "../escape" })).toThrow();
  });

  it("reads state written before usage accounting with an unknown baseline and cost", () => {
    const directory = join(mkdtempSync(join(tmpdir(), "claude-agent-host-state-")), "state");
    const appThreadId = "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d7f";
    const threadDirectory = join(directory, "threads", appThreadId);
    mkdirSync(threadDirectory, { recursive: true });
    const used = { ...ZERO_USAGE, inputTokens: 5, totalTokens: 5 };
    const { cacheWriteInputTokens: _absent, ...legacyUsage } = used;
    writeFileSync(
      join(threadDirectory, "state.json"),
      JSON.stringify({
        appThreadId,
        createdAt: 1,
        cwd: "/w",
        origin: "created",
        pendingSettings: null,
        presence: { archived: false, type: "listed" },
        recencyAt: null,
        sessionIds: [appThreadId],
        sessionStarted: true,
        settings: { effort: null, model: "m", permissionProfile: ":workspace", serviceTier: null },
        title: { type: "none" },
        totalUsage: legacyUsage,
        turns: [
          {
            anchors: [],
            completedAt: 2,
            origin: "user",
            outcome: { status: "completed" },
            prompts: [],
            startedAt: 1,
            turnId: "turn",
          },
        ],
        updatedAt: 1,
        version: 2,
      }),
    );
    const [loaded] = new ThreadStateStore(directory).load(() => {});
    expect(loaded?.state).toMatchObject({
      totalCost: { type: "unknown" },
      totalUsage: used,
      turns: [{ turnId: "turn", usage: null }],
      usageBaseline: { type: "unknown" },
    });
  });

  it("stores no conversation content", () => {
    const sources = files(join(root, "src", "state"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/firstUserMessage|preview|historyLines/);
  });
});
