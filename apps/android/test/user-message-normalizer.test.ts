import { describe, expect, it } from "vitest";

import { normalizeUserMessage } from "../src/rendering/user-message-normalizer";

describe("normalizeUserMessage", () => {
  it("shows authored question replies without the transport envelope", () => {
    const source = `<send_user_message_question_reply>\n${JSON.stringify([
      { questionItemId: "question-1", question: "Which logs?", answer: "https://example.invalid/logs" },
      { questionItemId: "question-2", question: "Which environment?", answer: "Production\nSecond line" },
    ])}\n</send_user_message_question_reply>`;
    expect(normalizeUserMessage(source)).toEqual({
      text: "https://example.invalid/logs\n\nProduction\nSecond line", files: [],
    });
  });

  it.each([
    '<send_user_message_question_reply>not JSON</send_user_message_question_reply>',
    '<send_user_message_question_reply>[]</send_user_message_question_reply>',
    '<send_user_message_question_reply>[{"answer":"unproven envelope"}]</send_user_message_question_reply>',
    '<send_user_message_question_reply>[{"questionItemId":"q","question":"Q?","answer":false}]</send_user_message_question_reply>',
    'Example: <send_user_message_question_reply>[{"questionItemId":"q","question":"Q?","answer":"Keep it"}]</send_user_message_question_reply>',
    '```xml\n<send_user_message_question_reply>[{"questionItemId":"q","question":"Q?","answer":"Keep it"}]</send_user_message_question_reply>\n```',
  ])("preserves malformed or quoted question reply envelopes", (source) => {
    expect(normalizeUserMessage(source)).toEqual({ text: source, files: [] });
  });

  it.each(["\n", "\r\n"])("strips the complete Desktop browser wrapper with short request heading (%j)", (newline) => {
    const source = [
      "", '<in-app-browser-context source="ambient-ui-state">', "Automatically supplied UI state.", "# In app browser:", "",
      "https://example.invalid/review", "</in-app-browser-context>", "", "## My request:", "",
      "Проверь страницу.", "", "## My request:", "Этот заголовок — часть моего текста.",
    ].join(newline);
    expect(normalizeUserMessage(source)).toEqual({
      text: ["Проверь страницу.", "", "## My request:", "Этот заголовок — часть моего текста."].join(newline), files: [],
    });
  });

  it.each([
    "## My request:\n\nKeep my heading.",
    "An example:\n\n# In app browser:\n\n## My request:\nKeep this example.",
    "# In app browser:\n\n## My request:\nNo browser envelope here.",
    "```markdown\n## My request:\nDo not strip this code.\n```",
  ])("preserves a short request heading without a proven Desktop envelope", (source) => {
    expect(normalizeUserMessage(source)).toEqual({ text: source, files: [] });
  });

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
