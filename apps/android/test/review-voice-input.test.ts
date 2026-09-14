import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { codeReviewVoiceInputScope, type CodeReviewLineReference } from "../src/rendering/code-review";

const codeReviewWorkspace = readFileSync(new URL("../src/rendering/CodeReviewWorkspace.tsx", import.meta.url), "utf8");
const imagePreviewHost = readFileSync(new URL("../src/rendering/ImagePreviewHost.tsx", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const fullscreenModal = readFileSync(new URL("../src/ui/AppFullscreenModal.native.tsx", import.meta.url), "utf8");

describe("review voice input", () => {
  it("keeps a line's voice identity stable and isolates other lines, files, windows and threads", () => {
    const line: CodeReviewLineReference = { path: "a.ts", line: 7, side: "new" };
    const scope = codeReviewVoiceInputScope("thread-a", "window-a", line);
    expect(codeReviewVoiceInputScope("thread-a", "window-a", { ...line, column: 2, context: "changed display context" })).toBe(scope);
    const otherScopes = [
      codeReviewVoiceInputScope("thread-b", "window-a", line),
      codeReviewVoiceInputScope("thread-a", "window-b", line),
      codeReviewVoiceInputScope("thread-a", "window-a", { ...line, line: 8 }),
      codeReviewVoiceInputScope("thread-a", "window-a", { ...line, path: "b.ts" }),
      codeReviewVoiceInputScope("thread-a", "window-a", { ...line, side: "old" }),
      codeReviewVoiceInputScope("thread-a", "window-a", { ...line, coordinate: "diff" }),
    ];
    expect(otherScopes).not.toContain(scope);
    expect(new Set(otherScopes).size).toBe(otherScopes.length);
  });

  it("keeps Changes subscribed to live voice state after the overlay opens", () => {
    expect(codeReviewWorkspace).toContain("const voiceResource = useVoiceInputResource(voiceRuntime, voiceScope);");
    expect(codeReviewWorkspace).toContain('voiceController.toggle(voiceScope)');
    expect(codeReviewWorkspace).toContain('else if (voiceResource.phase !== "finishing") await voiceController.finish(voiceScope, false);');
    expect(codeReviewWorkspace).toContain("updateDraft: updateCommentDraft");
    expect(codeReviewWorkspace).toContain("voiceController?.unbind(voiceScope)");
  });

  it("does not retain the removed point-caption editor in image previews", () => {
    expect(imagePreviewHost).toContain("Annotate image in QuickDraw");
    expect(imagePreviewHost).not.toContain("voiceRuntime");
    expect(imagePreviewHost).not.toContain("<TextInput");
    expect(imagePreviewHost).not.toContain("annotationDraft");
  });

  it("connects review voice capture and fullscreen overlays to the shared native glow", () => {
    expect(screen).toContain("voiceRuntime={appVoiceInputRuntime}");
    expect(fullscreenModal).toContain("setNativeVoiceAuraTarget(reactTag)");
  });
});
