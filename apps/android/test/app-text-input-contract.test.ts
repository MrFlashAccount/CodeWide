import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const largePasteModule = readFileSync(
  new URL("../android/app/src/main/java/dev/codewide/app/remote/LargePasteModule.kt", import.meta.url),
  "utf8",
);
const largePastePolicy = readFileSync(
  new URL("../android/app/src/main/java/dev/codewide/app/remote/LargePastePolicy.kt", import.meta.url),
  "utf8",
);
const codeReviewEditor = readFileSync(new URL("../src/rendering/CodeReviewEditor.web.tsx", import.meta.url), "utf8");
const heroBottomSheetPrimitive = readFileSync(
  new URL("../node_modules/heroui-native/src/primitives/bottom-sheet/bottom-sheet.tsx", import.meta.url),
  "utf8",
);
const heroBottomSheetContent = readFileSync(
  new URL(
    "../node_modules/heroui-native/src/helpers/internal/components/bottom-sheet-content.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("application text input contract", () => {
  it("routes every application field through AppTextInput", () => {
    const nativeInputOwners = globSync("**/*.tsx", { cwd: sourceRoot })
      .filter((path) => readFileSync(`${sourceRoot}${path}`, "utf8").includes("TextInput as NativeTextInput"));

    expect(nativeInputOwners).toEqual(["ui/Typography.tsx"]);
  });

  it("provides one voice runtime around both adaptive roots", () => {
    expect(screen).toContain("const voiceInputRuntime: AppVoiceInputRuntime");
    expect(screen.match(/<AppVoiceInputProvider runtime=\{voiceInputRuntime\}>/gu)).toHaveLength(2);
  });

  it("keeps fields with specialized voice controls opted out", () => {
    expect(screen).toMatch(/<TextInput\s+voiceInput=\{false\}\s+accessibilityLabel="Message Codex"/u);
    expect(codeReviewEditor).toMatch(/<TextInput\s+voiceInput=\{false\}\s+autoFocus/u);
  });

  it("lets the composer inspect a complete paste before applying the message limit", () => {
    const composerStart = screen.indexOf('accessibilityLabel="Message Codex"');
    const composerEnd = screen.indexOf("/>", composerStart);
    expect(composerStart).toBeGreaterThan(-1);
    expect(screen.slice(composerStart, composerEnd)).not.toContain("maxLength=");
    expect(screen.slice(composerStart, composerEnd)).toContain("largePasteThreshold: AUTO_ATTACH_PASTE_MIN_CHARS");
    expect(screen.slice(composerStart, composerEnd)).toContain("onLargePaste: handleComposerLargePaste");
    expect(screen).not.toContain("LARGE_PASTE_SETTLE_MS");
    expect(screen).not.toContain("beginLargePasteCapture");
  });

  it("installs native receivers for both Android content events and chunked keyboard paste", () => {
    expect(largePasteModule).toContain("UIManagerListener");
    expect(largePasteModule).toContain("override fun didMountItems(uiManager: UIManager)");
    expect(largePasteModule).toContain("installRequestedViews(uiManager)");
    expect(largePasteModule).toContain("ClipboardChunkInputFilter");
    expect(largePasteModule).toContain("view.filters = arrayOf(inputFilter, *view.filters)");
    expect(largePasteModule).toContain("clipboard.primaryClip");
    expect(largePasteModule).toContain("emitLargePaste(registration, clipboardText");
    expect(largePasteModule).not.toContain("MAX_RESOLVE_ATTEMPTS");
    expect(largePastePolicy).toContain("ContentInfoCompat.SOURCE_CLIPBOARD");
    expect(largePastePolicy).toContain("ContentInfoCompat.SOURCE_INPUT_METHOD");
    expect(largePastePolicy).toContain("shouldInterceptClipboardChunk");
  });

  it("keeps the conversation composer attached to every IME session", () => {
    expect(screen).toContain("<KeyboardStickyView\n        enabled");
    expect(screen).not.toContain("composerTracksKeyboard");
    expect(screen).not.toContain("setComposerTracksKeyboard");
  });

  it("does not mount any HeroUI bottom-sheet portal subtree while closed", () => {
    expect(heroBottomSheetPrimitive).toContain("if (!value.isOpen) return null;");
    expect(heroBottomSheetPrimitive).not.toContain("forceMount");
    expect(heroBottomSheetContent).toContain("index={isOpen ? (initialIndex ?? 0) : -1}");
  });
});
