import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { projectUserMessageAttachments } from "../src/rendering/user-message-attachments";

const ownerOptimisticTurn = readFileSync(new URL("../src/features/conversation/turns/OptimisticTurn.tsx", import.meta.url), "utf8");

const userTurnBody = readFileSync(new URL("../src/features/conversation/turns/UserTurnBody.tsx", import.meta.url), "utf8");

describe("projectUserMessageAttachments", () => {
  it("uses the shared renderer for pending and authoritative user messages", () => {
    const authoritative = readFileSync(new URL("../src/features/conversation/turns/TurnTimelineItem.tsx", import.meta.url), "utf8");
    const protocol = readFileSync(new URL("../src/features/conversation/protocol/ProtocolBlock.tsx", import.meta.url), "utf8");
    expect(ownerOptimisticTurn).toContain("localAttachments={item.attachments}");
    expect(userTurnBody).toContain("projectedAttachments={block.raw.codewideAttachments}");
    expect(protocol).toContain("projectedAttachments={block.raw.codewideAttachments}");
    expect(userTurnBody).toContain("<UserMessageContent");
    expect(protocol).toContain("<UserMessageContent");
    expect(ownerOptimisticTurn).toContain("<UserMessageContent");
  });

  it("uses the companion projection derived from the persisted session", () => {
    expect(projectUserMessageAttachments([], {
      version: 1,
      items: [
        { kind: "image", name: "shot.png", source: { type: "path", path: "/srv/codex/shot.png" } },
        { kind: "file", name: "plan.md", source: { type: "path", path: "/srv/codex/plan.md" } },
      ],
    })).toEqual([
      { kind: "image", name: "shot.png", source: { type: "path", path: "/srv/codex/shot.png" } },
      { kind: "file", name: "plan.md", source: { type: "path", path: "/srv/codex/plan.md" } },
    ]);
  });

  it("reconstructs legacy session attachments from raw user content", () => {
    expect(projectUserMessageAttachments([
      { type: "localImage", path: "/srv/codex/shot.png" },
      {
        type: "text",
        text: "# Files mentioned by the user:\n\n## plan.md: /srv/codex/plan.md\n\n## My request for Codex:\n\nReview it.",
      },
    ])).toEqual([
      { kind: "image", name: "shot.png", source: { type: "path", path: "/srv/codex/shot.png" } },
      { kind: "file", name: "plan.md", source: { type: "path", path: "/srv/codex/plan.md" } },
    ]);
  });

  it("uses scoped outbox references only before the session item arrives", () => {
    expect(projectUserMessageAttachments([], undefined, [{
      id: "upload",
      rootId: "attachments",
      path: "sessions/thread/files/shot.png",
      name: "shot.png",
      kind: "image",
    }])).toEqual([{
      kind: "image",
      name: "shot.png",
      source: { type: "scoped", rootId: "attachments", path: "sessions/thread/files/shot.png" },
    }]);
  });

  it("deduplicates the bounded projection and raw session content", () => {
    expect(projectUserMessageAttachments(
      [{ type: "localImage", path: "/srv/codex/shot.png" }],
      { version: 1, items: [{ kind: "image", name: "shot.png", source: { type: "path", path: "/srv/codex/shot.png" } }] },
    )).toHaveLength(1);
  });
});
