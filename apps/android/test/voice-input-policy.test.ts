import { describe, expect, it } from "vitest";

import { shouldEnableVoiceInput } from "../src/ui/voice-input-policy";

describe("voice input policy", () => {
  it("enables natural-language fields by default", () => {
    expect(shouldEnableVoiceInput({})).toBe(true);
    expect(shouldEnableVoiceInput({ keyboardType: "default" })).toBe(true);
    expect(shouldEnableVoiceInput({ inputMode: "text" })).toBe(true);
    expect(shouldEnableVoiceInput({ inputMode: "search" })).toBe(true);
  });

  it("disables secrets and structured fields", () => {
    expect(shouldEnableVoiceInput({ secureTextEntry: true })).toBe(false);
    expect(shouldEnableVoiceInput({ keyboardType: "number-pad" })).toBe(false);
    expect(shouldEnableVoiceInput({ keyboardType: "url" })).toBe(false);
    expect(shouldEnableVoiceInput({ inputMode: "numeric" })).toBe(false);
    expect(shouldEnableVoiceInput({ editable: false })).toBe(false);
  });

  it("honors an explicit override", () => {
    expect(shouldEnableVoiceInput({ voiceInput: false })).toBe(false);
    expect(shouldEnableVoiceInput({ voiceInput: true, secureTextEntry: true, keyboardType: "number-pad" })).toBe(true);
  });
});
