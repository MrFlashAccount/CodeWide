import type { V2ThreadSummary } from "@codewide/sync-client/v2";
import { describe, expect, it } from "vitest";

import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import { agentWorkspaceRows } from "../src/v2/features/agents/agentWorkspaceRows";
import { selectedAgentThread } from "../src/v2/features/agents/agentSelection";

describe("V2 agent thread selection", () => {
  it("keeps the selected child on the owning saved server", () => {
    const owner = qualifiedThread(savedServerId("server-a"), threadId("parent-thread"));

    expect(selectedAgentThread(owner, "child-thread")).toEqual(
      qualifiedThread(savedServerId("server-a"), threadId("child-thread")),
    );
    expect(selectedAgentThread(owner, null)).toBeNull();
  });

  it("renders only the authoritative child relation returned for the parent", () => {
    const child: V2ThreadSummary = {
      archived: false,
      createdAt: "2026-08-27T17:30:00Z",
      headTurnId: null,
      id: "child-thread",
      lastActivityAt: "2026-08-27T17:32:00Z",
      parentId: "parent-thread",
      preview: "Inspecting the API",
      readState: {
        kind: "read",
        latestActivityMarker: null,
        readThroughMarker: null,
        unreadCount: 0,
      },
      settings: null,
      state: "running" as const,
      title: "Research API",
      updatedAt: "2026-08-27T17:32:00Z",
      workspace: "/workspace/project",
    };

    expect(agentWorkspaceRows([child])).toEqual([
      expect.objectContaining({
        active: true,
        id: "child-thread",
        subtitle: "running · /workspace/project",
        title: "Research API",
      }),
    ]);
  });
});
