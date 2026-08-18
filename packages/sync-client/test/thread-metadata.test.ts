import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import { restoreSubagentParent } from "../src/thread-metadata.js";

describe("restoreSubagentParent", () => {
  it("restores the parent omitted by an unscoped subagent thread/list response", () => {
    const summary = thread({
      parentThreadId: null,
      source: {
        subAgent: {
          thread_spawn: {
            parent_thread_id: "root-thread",
            depth: 1,
            agent_path: "/root/audit",
            agent_nickname: "Curie",
            agent_role: null,
          },
        },
      },
    });

    expect(restoreSubagentParent(summary)).toEqual({ ...summary, parentThreadId: "root-thread" });
  });

  it("does not replace an explicit parent or infer one for non-spawn sources", () => {
    const explicit = thread({
      parentThreadId: "explicit-parent",
      source: {
        subAgent: {
          thread_spawn: {
            parent_thread_id: "source-parent",
            depth: 1,
            agent_path: null,
            agent_nickname: null,
            agent_role: null,
          },
        },
      },
    });
    const review = thread({ parentThreadId: null, source: { subAgent: "review" } });

    expect(restoreSubagentParent(explicit)).toBe(explicit);
    expect(restoreSubagentParent(review)).toBe(review);
  });
});

function thread(overrides: Partial<Thread>): Thread {
  return {
    id: "subagent-thread",
    extra: null,
    sessionId: "subagent-thread",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    historyMode: "paginated",
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    status: { type: "notLoaded" },
    path: null,
    cwd: "/workspace",
    cliVersion: "0.147.0",
    source: "appServer",
    canAcceptDirectInput: null,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...overrides,
  };
}
