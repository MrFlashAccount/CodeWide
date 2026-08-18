import { describe, expect, it } from "vitest";

import { normalizeUserMessage } from "../src/rendering/user-message-normalizer";

describe("normalizeUserMessage", () => {
  it("projects the authored request and extracts file metadata", () => {
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
      "Открой картинку и проверь ссылку.",
    ].join("\n");

    expect(normalizeUserMessage(source)).toEqual({
      text: "Открой картинку и проверь ссылку.",
      files: [{ name: "Photo 1.jpg", path: "/tmp/codex/Photo 1.jpg" }],
    });
  });

  it("removes ambient and image transport tags without hiding authored text", () => {
    const source = [
      '<in-app-browser-context source="ambient-ui-state">hidden</in-app-browser-context>',
      "Обычный текст <image name=[Image #1] path=\"/tmp/1.jpg\"></image>",
    ].join("\n");

    expect(normalizeUserMessage(source)).toEqual({ text: "Обычный текст", files: [] });
  });

  it("does not treat arbitrary Markdown headings as a protocol envelope", () => {
    const source = "# Files I use\n\n## My request\n\nKeep all of this.";
    expect(normalizeUserMessage(source)).toEqual({ text: source, files: [] });
  });
});
