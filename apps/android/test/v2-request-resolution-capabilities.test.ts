import { describe, expect, it, vi } from "vitest";
import type { V2PendingRequest } from "@codewide/sync-client/v2";

import { RequestResolutionCapabilities } from "../src/v2/application/requestResolutionCapabilities";
import { savedServerId } from "../src/v2/domain/ids";

const serverId = savedServerId("saved-server-a");
const request: V2PendingRequest = {
  availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
  generation: "9",
  grantRoot: "/workspace",
  id: "approval-a",
  itemId: "item-a",
  kind: "fileChangeApproval",
  reason: "Apply src/example.ts",
  threadId: "thread-a",
  turnId: "turn-a",
};

describe("RequestResolutionCapabilities", () => {
  it("sends the authoritative id and generation through durable request.resolve", async () => {
    const execute = vi.fn(() => Promise.resolve(completedResolution(request.id)));
    const capability = new RequestResolutionCapabilities({ execute });

    await capability.resolve(serverId, request, {
      decision: "accept",
      kind: "fileChangeApproval",
    });

    expect(execute).toHaveBeenCalledWith(serverId, {
      generation: "9",
      kind: "request.resolve",
      requestId: "approval-a",
      resolution: { decision: "accept", kind: "fileChangeApproval" },
    });
  });

  it("surfaces durable command failure", async () => {
    const execute = vi.fn(() =>
      Promise.resolve({
        error: {
          code: "sourceUnavailable" as const,
          message: "offline",
          recovery: "retry" as const,
        },
        operationId: "operation-a",
        type: "commandFailed" as const,
      }),
    );
    const capability = new RequestResolutionCapabilities({ execute });

    await expect(
      capability.resolve(serverId, request, {
        decision: "decline",
        kind: "fileChangeApproval",
      }),
    ).rejects.toThrow("offline");
  });

  it("rejects an unrelated command result", async () => {
    const capability = new RequestResolutionCapabilities({
      execute: () => Promise.resolve(completedResolution("another-request")),
    });

    await expect(
      capability.resolve(serverId, request, {
        decision: "decline",
        kind: "fileChangeApproval",
      }),
    ).rejects.toThrow("unrelated request resolution");
  });
});

function completedResolution(requestId: string) {
  return {
    operationId: "operation-a",
    result: { kind: "request.resolve" as const, requestId, state: "resolved" as const },
    type: "commandCompleted" as const,
  };
}
