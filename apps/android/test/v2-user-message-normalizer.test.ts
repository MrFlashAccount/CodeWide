import type { V2TurnView } from "@codewide/sync-client/v2";
import { describe, expect, it } from "vitest";

import { timelineTurnsDisplayModel } from "../src/v2/features/conversation/timelineDisplayModel";
import { normalizeUserMessage } from "../src/v2/features/conversation/userMessageNormalizer";

describe("V2 user message normalization", () => {
  it("shows only authored text and extracts exact transport-envelope file metadata", () => {
    const source = [
      "# Files mentioned by the user:",
      "",
      "## Photo 1.jpg: `/tmp/codex/Photo 1.jpg`",
      "",
      '<in-app-browser-context source="ambient-ui-state">',
      "private ambient state",
      "</in-app-browser-context>",
      "",
      "## My request for Codex:",
      "",
      '<image name="Photo 1">Открой картинку.</image>',
    ].join("\n");

    expect(normalizeUserMessage(source)).toEqual({
      files: [{ name: "Photo 1.jpg", path: "/tmp/codex/Photo 1.jpg" }],
      text: "Открой картинку.",
    });
  });

  it("preserves source block order while deduplicating an extracted file mention", () => {
    const [display] = timelineTurnsDisplayModel(
      [
        turn([
          {
            clientId: "client",
            content: [
              {
                kind: "text",
                text: [
                  "# Files mentioned by the user:",
                  "",
                  "## report.md: `/workspace/report.md`",
                  "",
                  "## My request for Codex:",
                  "",
                  "Review this.",
                ].join("\n"),
                textElements: [{ byteRange: { end: 1, start: 0 }, placeholder: "stale" }],
              },
              { kind: "skill", name: "review", path: "/skills/review/SKILL.md" },
              { kind: "mention", name: "wrong duplicate", path: "/workspace/report.md" },
              { kind: "text", text: "Then summarize.", textElements: [] },
            ],
            id: "user",
            kind: "userMessage",
          },
        ]),
      ],
      [
        {
          downloadUrl: "/v2/files/report",
          id: "report",
          mediaType: "text/markdown",
          name: "report.md",
          sizeBytes: "42",
        },
      ],
    );

    expect(display?.userInput).toEqual([
      { kind: "text", text: "Review this.", textElements: [] },
      {
        attachment: {
          downloadUrl: "/v2/files/report",
          id: "report",
          mediaType: "text/markdown",
          name: "report.md",
          sizeBytes: "42",
        },
        kind: "mention",
        name: "report.md",
        path: "/workspace/report.md",
        reference: "/workspace/report.md",
      },
      { kind: "skill", name: "review", path: "/skills/review/SKILL.md" },
      { kind: "text", text: "Then summarize.", textElements: [] },
    ]);
    expect(display?.userText).toEqual(["Review this.", "Then summarize."]);
  });

  it("does not strip ordinary Markdown that is not the exact transport envelope", () => {
    const source = "## My request for another tool:\n\nKeep this heading.";
    expect(normalizeUserMessage(source)).toEqual({ files: [], text: source });
  });
});

function turn(items: V2TurnView["items"]): V2TurnView {
  return {
    activity: null,
    completedAt: null,
    createdAt: null,
    durationMs: null,
    id: "turn",
    items,
    lifecycle: [],
    state: "completed",
    threadId: "thread",
    usage: null,
  };
}
