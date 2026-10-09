/**
 * The SDK session-store adapter against the real Agent SDK session API on a
 * throwaway Claude configuration directory (`CLAUDE_CONFIG_DIR`): listing
 * scopes, metadata, messages, rename and idempotent delete. No model call
 * and no access to the user's own sessions.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSdkSessionStore } from "../src/claude/sdkSessionStore.js";

const TERMINAL = "11111111-1111-4111-8111-111111111111";
const PROGRAMMATIC = "22222222-2222-4222-8222-222222222222";
const CWD = "/workspace";

function transcript(sessionId: string, entrypoint: string): string {
  const base = {
    cwd: CWD,
    entrypoint,
    gitBranch: "main",
    isSidechain: false,
    sessionId,
    userType: "external",
    version: "2.1.111",
  };
  const prompt = `${sessionId.slice(0, 8)}-0000-4000-8000-000000000001`;
  return [
    {
      ...base,
      message: { content: "Say hi", role: "user" },
      parentUuid: null,
      timestamp: "2026-10-01T10:00:00.000Z",
      type: "user",
      uuid: prompt,
    },
    {
      ...base,
      message: {
        content: [{ text: "hi", type: "text" }],
        id: "msg_1",
        model: "m",
        role: "assistant",
        type: "message",
      },
      parentUuid: prompt,
      timestamp: "2026-10-01T10:00:01.000Z",
      type: "assistant",
      uuid: `${sessionId.slice(0, 8)}-0000-4000-8000-000000000002`,
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n");
}

describe("Claude session store through the Agent SDK", () => {
  const previous = process.env["CLAUDE_CONFIG_DIR"];

  beforeAll(() => {
    const configDirectory = mkdtempSync(join(tmpdir(), "claude-agent-host-config-"));
    const project = join(configDirectory, "projects", "-workspace");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, `${TERMINAL}.jsonl`), `${transcript(TERMINAL, "cli")}\n`);
    writeFileSync(
      join(project, `${PROGRAMMATIC}.jsonl`),
      `${transcript(PROGRAMMATIC, "sdk-ts")}\n`,
    );
    process.env["CLAUDE_CONFIG_DIR"] = configDirectory;
  });

  afterAll(() => {
    if (previous === undefined) delete process.env["CLAUDE_CONFIG_DIR"];
    else process.env["CLAUDE_CONFIG_DIR"] = previous;
  });

  it("lists interactive sessions separately from SDK-started ones", async () => {
    const store = createSdkSessionStore();
    expect(
      (await store.list({ dir: null, limit: null, offset: 0, scope: "interactive" })).map(
        (session) => session.sessionId,
      ),
    ).toEqual([TERMINAL]);
    expect(
      (await store.list({ dir: null, limit: null, offset: 0, scope: "all" }))
        .map((session) => session.sessionId)
        .toSorted(),
    ).toEqual([TERMINAL, PROGRAMMATIC]);
  });

  it("pages one project directory with change metadata", async () => {
    const store = createSdkSessionStore();
    const first = await store.list({ dir: CWD, limit: 1, offset: 0, scope: "all" });
    const second = await store.list({ dir: CWD, limit: 1, offset: 1, scope: "all" });
    expect([...first, ...second].map((session) => session.sessionId).toSorted()).toEqual([
      TERMINAL,
      PROGRAMMATIC,
    ]);
    expect(first[0]).toMatchObject({ cwd: CWD, summary: "Say hi" });
    expect(first[0]?.fileSize).toBeGreaterThan(0);
    expect(await store.list({ dir: "/elsewhere", limit: null, offset: 0, scope: "all" })).toEqual(
      [],
    );
    expect(await store.subagents({ cwd: CWD, sessionId: TERMINAL })).toEqual([]);
  });

  it("reads metadata and messages", async () => {
    const store = createSdkSessionStore();
    expect(await store.info({ cwd: CWD, sessionId: TERMINAL })).toMatchObject({
      createdAtMs: Date.parse("2026-10-01T10:00:00.000Z"),
      cwd: CWD,
      firstPrompt: "Say hi",
      sessionId: TERMINAL,
      title: null,
    });
    expect(
      await store.info({ cwd: null, sessionId: "33333333-3333-4333-8333-333333333333" }),
    ).toBeNull();
    const messages = await store.messages({ cwd: CWD, sessionId: TERMINAL });
    expect(
      messages.map((message) =>
        typeof message === "object" && message !== null ? Reflect.get(message, "type") : null,
      ),
    ).toEqual(["user", "assistant"]);
  });

  it("renames and deletes; a repeated delete reports the session missing", async () => {
    const store = createSdkSessionStore();
    await store.rename({ cwd: CWD, sessionId: TERMINAL }, "Greeting");
    expect(await store.info({ cwd: CWD, sessionId: TERMINAL })).toMatchObject({
      title: "Greeting",
    });
    expect(await store.remove({ cwd: CWD, sessionId: TERMINAL })).toBe("removed");
    expect(await store.remove({ cwd: CWD, sessionId: TERMINAL })).toBe("missing");
    expect(await store.info({ cwd: CWD, sessionId: TERMINAL })).toBeNull();
  });
});
