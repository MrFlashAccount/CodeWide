import { describe, expect, it } from "vitest";

import { projectUserMessageAttachments } from "../src/rendering/user-message-attachments";

describe("projectUserMessageAttachments", () => {
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
