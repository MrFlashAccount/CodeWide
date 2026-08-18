import { describe, expect, it } from "vitest";

import { insertTranscriptAtSelection } from "../src/data/voice-draft";

describe("voice transcript insertion", () => {
  it("inserts at the cursor without replacing the suffix", () => {
    expect(insertTranscriptAtSelection("hello world", { start: 5, end: 5 }, "brave")).toEqual({
      text: "hello brave world",
      cursor: 11,
    });
  });

  it("replaces the selected range and preserves punctuation", () => {
    expect(insertTranscriptAtSelection("Say old, please", { start: 4, end: 7 }, "new words")).toEqual({
      text: "Say new words, please",
      cursor: 13,
    });
  });

  it("clamps stale native selections", () => {
    expect(insertTranscriptAtSelection("Hi", { start: 99, end: 99 }, "there")).toEqual({
      text: "Hi there",
      cursor: 8,
    });
  });
});
