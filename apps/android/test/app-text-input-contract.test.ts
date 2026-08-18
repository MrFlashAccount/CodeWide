import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
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
