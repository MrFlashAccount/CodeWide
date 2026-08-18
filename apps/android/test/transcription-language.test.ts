import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import { transcriptionLanguageHint } from "../src/data/transcription-language";

describe("transcription language hint", () => {
  it("keeps technical Russian in Russian despite English identifiers", () => {
    expect(transcriptionLanguageHint(thread("Почини streaming renderer и OpenTelemetry таблицы в Android приложении"))).toBe("ru");
  });

  it("selects English for an English conversation", () => {
    expect(transcriptionLanguageHint(thread("Please fix the streaming renderer and table layout in the Android application"))).toBe("en");
  });

  it("leaves ambiguous short context to automatic detection", () => {
    expect(transcriptionLanguageHint(thread("Ок"))).toBeNull();
  });
});

function thread(text: string): Thread {
  return {
    id: "thread",
    preview: "",
    modelProvider: "openai",
    createdAt: 0,
    updatedAt: 0,
    status: { type: "idle" },
    path: "/workspace",
    cwd: "/workspace",
    cliVersion: "test",
    source: "test",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [{
      id: "turn",
      status: "completed",
      error: null,
      startedAt: 0,
      completedAt: 1,
      durationMs: 1,
      itemsView: "full",
      items: [{ type: "userMessage", id: "user", clientId: null, content: [{ type: "text", text, text_elements: [] }] }],
    }],
  } as unknown as Thread;
}
