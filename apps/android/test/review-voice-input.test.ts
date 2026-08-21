import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { reviewVoiceInputScope, type AppVoiceInputRuntime } from "../src/ui/VoiceInputRuntime";

const codeReviewWorkspace = readFileSync(new URL("../src/rendering/CodeReviewWorkspace.tsx", import.meta.url), "utf8");
const imagePreviewHost = readFileSync(new URL("../src/rendering/ImagePreviewHost.tsx", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const fullscreenModal = readFileSync(new URL("../src/ui/AppFullscreenModal.native.tsx", import.meta.url), "utf8");

describe("review voice input", () => {
  it("uses one stable review scope for every fullscreen review surface", () => {
    const runtime = { scopePrefix: "connection\u0000thread" } as AppVoiceInputRuntime;
    expect(reviewVoiceInputScope(runtime)).toBe("connection\u0000thread\u0000review");
  });

  it("keeps Changes subscribed to live voice state after the overlay opens", () => {
    expect(codeReviewWorkspace).toContain("const voiceResource = useVoiceInputResource(voiceRuntime, voiceScope);");
    expect(codeReviewWorkspace).toContain('else if (voiceResource?.phase === undefined || voiceResource.phase === "idle") await voiceController.toggle();');
    expect(codeReviewWorkspace).toContain('else if (voiceResource.phase !== "finishing") await voiceController.finish(false);');
    expect(codeReviewWorkspace).toContain("updateDraft: updateCommentDraft");
    expect(codeReviewWorkspace).toContain("voiceController?.unbind(voiceScope)");
  });

  it("bridges the active voice runtime into image point captions", () => {
    expect(imagePreviewHost).toContain("voiceRuntime={annotationRegistrationRef.current?.voiceRuntime ?? null}");
    expect(imagePreviewHost).toContain("<AppVoiceInputProvider runtime={voiceRuntime}>{preview}</AppVoiceInputProvider>");
    expect(imagePreviewHost).toMatch(/<TextInput[\s\S]*voiceInput[\s\S]*voiceScope/u);
    expect(imagePreviewHost).toContain('voicePhase !== "idle"');
  });

  it("lets any recording review scope drive the shared native glow", () => {
    expect(screen).toContain('voiceInputsQuery.data?.find((resource) => resource?.phase === "recording") ?? null');
    expect(screen).toContain("voiceRuntime={appVoiceInputRuntime}");
    expect(fullscreenModal).toContain("setNativeVoiceAuraTarget(reactTag)");
  });
});
