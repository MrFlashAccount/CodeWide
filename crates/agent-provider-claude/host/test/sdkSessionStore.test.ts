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
import { loadAgentSdk } from "../src/claude/sdkModule.js";

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

const COMPACTED = "55555555-5555-4555-8555-555555555555";
/** The compacted session lives in a configuration directory of its own, so the listing tests see only their sessions. */
const COMPACTED_CWD = "/compacted";

/** A session compacted once: a prompt and answer, the boundary, the summary and a later prompt. */
function compactedTranscript(): string {
  const base = {
    cwd: COMPACTED_CWD,
    entrypoint: "cli",
    isSidechain: false,
    sessionId: COMPACTED,
    userType: "external",
    version: "2.1.296",
  };
  const id = (n: number): string => `55555555-0000-4000-8000-00000000000${String(n)}`;
  const at = (second: number): string => `2026-10-01T10:00:0${String(second)}.000Z`;
  const answer = (uuid: string, parentUuid: string, text: string, second: number) => ({
    ...base,
    message: {
      content: [{ text, type: "text" }],
      id: `msg_${uuid}`,
      model: "m",
      role: "assistant",
      type: "message",
    },
    parentUuid,
    timestamp: at(second),
    type: "assistant",
    uuid,
  });
  return [
    {
      ...base,
      message: { content: "Before compaction", role: "user" },
      parentUuid: null,
      timestamp: at(1),
      type: "user",
      uuid: id(1),
    },
    answer(id(2), id(1), "old answer", 2),
    {
      ...base,
      compactMetadata: {
        preservedMessages: { anchorUuid: id(4), uuids: [id(2)] },
        trigger: "manual",
      },
      content: "Conversation compacted",
      logicalParentUuid: id(2),
      parentUuid: null,
      subtype: "compact_boundary",
      timestamp: at(3),
      type: "system",
      uuid: id(3),
    },
    {
      ...base,
      isCompactSummary: true,
      message: { content: "Summary", role: "user" },
      parentUuid: id(3),
      timestamp: at(4),
      type: "user",
      uuid: id(4),
    },
    {
      ...base,
      message: { content: "After compaction", role: "user" },
      parentUuid: id(4),
      timestamp: at(5),
      type: "user",
      uuid: id(5),
    },
    answer(id(6), id(5), "new answer", 6),
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

  it("reads a compacted session's whole history, the SDK's own read only its newest part", async () => {
    const configDirectory = mkdtempSync(join(tmpdir(), "claude-agent-host-compacted-"));
    const project = join(configDirectory, "projects", "-compacted");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, `${COMPACTED}.jsonl`), `${compactedTranscript()}\n`);
    const shared = process.env["CLAUDE_CONFIG_DIR"];
    process.env["CLAUDE_CONFIG_DIR"] = configDirectory;
    try {
      const sdk = await loadAgentSdk(null);
      const texts = (messages: readonly unknown[]): readonly string[] =>
        messages.flatMap((entry) => {
          const message: unknown =
            typeof entry === "object" && entry !== null ? Reflect.get(entry, "message") : null;
          const content: unknown =
            typeof message === "object" && message !== null
              ? Reflect.get(message, "content")
              : null;
          return typeof content === "string" ? [content] : [];
        });
      const location = { cwd: COMPACTED_CWD, sessionId: COMPACTED };
      expect(texts(await sdk.getSessionMessages(COMPACTED, { dir: COMPACTED_CWD }))).not.toContain(
        "Before compaction",
      );
      const messages = await createSdkSessionStore(sdk).messages(location);
      expect(texts(messages)).toEqual(["Before compaction", "Summary", "After compaction"]);
      expect(
        await createSdkSessionStore(sdk).messages({
          cwd: COMPACTED_CWD,
          sessionId: "44444444-4444-4444-8444-444444444444",
        }),
      ).toEqual([]);
    } finally {
      if (shared === undefined) delete process.env["CLAUDE_CONFIG_DIR"];
      else process.env["CLAUDE_CONFIG_DIR"] = shared;
    }
  });

  afterAll(() => {
    if (previous === undefined) delete process.env["CLAUDE_CONFIG_DIR"];
    else process.env["CLAUDE_CONFIG_DIR"] = previous;
  });

  it("lists interactive sessions separately from SDK-started ones", async () => {
    const store = createSdkSessionStore(await loadAgentSdk(null));
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
    const store = createSdkSessionStore(await loadAgentSdk(null));
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
    const store = createSdkSessionStore(await loadAgentSdk(null));
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
    const store = createSdkSessionStore(await loadAgentSdk(null));
    await store.rename({ cwd: CWD, sessionId: TERMINAL }, "Greeting");
    expect(await store.info({ cwd: CWD, sessionId: TERMINAL })).toMatchObject({
      title: "Greeting",
    });
    expect(await store.remove({ cwd: CWD, sessionId: TERMINAL })).toBe("removed");
    expect(await store.remove({ cwd: CWD, sessionId: TERMINAL })).toBe("missing");
    expect(await store.info({ cwd: CWD, sessionId: TERMINAL })).toBeNull();
  });
});
