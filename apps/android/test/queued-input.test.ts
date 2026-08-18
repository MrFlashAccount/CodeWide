import { describe, expect, it } from "vitest";

import { parseQueuedInput, queuedInputPayload } from "../src/data/queued-input";

describe("queued input", () => {
  it("keeps file attachments structured instead of flattening them into message text", () => {
    const input = parseQueuedInput({
      input: [
        { type: "text", text: "Review this", text_elements: [] },
        { type: "remoteFile", rootId: "attachments", path: "sessions/thread/files/review.md", name: "review.md", kind: "file" },
        { type: "skill", name: "ignored by the queue editor", path: "/tmp/SKILL.md" },
      ],
    });

    expect(input).toEqual({
      text: "Review this",
      attachments: [{
        id: "attachments\u0000sessions/thread/files/review.md",
        rootId: "attachments",
        path: "sessions/thread/files/review.md",
        name: "review.md",
        kind: "file",
      }],
    });
    expect(queuedInputPayload(input.text, input.attachments)).toEqual([
      { type: "text", text: "Review this", text_elements: [] },
      { type: "remoteFile", rootId: "attachments", path: "sessions/thread/files/review.md", name: "review.md", kind: "file" },
    ]);
  });

  it("supports attachment-only queued prompts", () => {
    expect(queuedInputPayload("", [{
      id: "file",
      rootId: "attachments",
      path: "notes.md",
      name: "notes.md",
      kind: "file",
    }])).toEqual([
      { type: "remoteFile", rootId: "attachments", path: "notes.md", name: "notes.md", kind: "file" },
    ]);
  });
});
