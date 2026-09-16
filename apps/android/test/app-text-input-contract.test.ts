import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compactSource, sourceHasJsxElement } from "./source-contract";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const screen = compactSource(
  readFileSync(new URL("../app/v1/V1WorkspaceShell.tsx", import.meta.url), "utf8"),
);
const largePasteModule = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/LargePasteModule.kt",
    import.meta.url,
  ),
  "utf8",
);
const largePastePolicy = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/LargePastePolicy.kt",
    import.meta.url,
  ),
  "utf8",
);
const codeReviewEditor = readFileSync(
  new URL("../src/features/review/editor/CodeReviewEditor.web.tsx", import.meta.url),
  "utf8",
);
const composerMarkdownInputWeb = readFileSync(
  new URL("../src/features/composer/input/ComposerMarkdownInput.web.tsx", import.meta.url),
  "utf8",
);
const composerMarkdownInputNative = readFileSync(
  new URL("../src/features/composer/input/ComposerMarkdownInput.native.tsx", import.meta.url),
  "utf8",
);
const ownerComposerEditor = compactSource(
  readFileSync(new URL("../src/features/composer/ComposerEditor.tsx", import.meta.url), "utf8"),
);

const layout = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationLayout.tsx", import.meta.url),
    "utf8",
  ),
);

const ownerWorkspaceConversationProviders = compactSource(
  readFileSync(
    new URL("../src/features/workspace/WorkspaceConversationProviders.tsx", import.meta.url),
    "utf8",
  ),
);

const workspaceShell = screen;
const listBinding = compactSource(
  readFileSync(
    new URL("../src/features/workspace/WorkspaceThreadList.tsx", import.meta.url),
    "utf8",
  ),
);

const threadRoute = compactSource(
  readFileSync(
    new URL("../app/v1/threads/[connectionId]/[threadId]/index.tsx", import.meta.url),
    "utf8",
  ),
);

describe("application text input contract", () => {
  it("routes every application field through AppTextInput", () => {
    const nativeInputOwners = globSync("**/*.tsx", { cwd: sourceRoot })
      .filter((path) => !path.startsWith("v2/"))
      .filter((path) =>
        readFileSync(`${sourceRoot}${path}`, "utf8").includes("TextInput as NativeTextInput"),
      );

    expect(nativeInputOwners).toEqual(["ui/Typography.tsx"]);
  });

  it("provides voice runtime around adaptive roots and the standalone browser; sidebar search inherits its root", () => {
    expect(ownerWorkspaceConversationProviders).toContain(
      "const voiceInputRuntime: AppVoiceInputRuntime",
    );
    const providers = ownerWorkspaceConversationProviders;
    expect(providers).toContain("<AppVoiceInputProvider runtime={voiceInputRuntime}>");
    expect(threadRoute.indexOf("<WorkspaceConversationProviders")).toBeLessThan(
      threadRoute.indexOf("<ActiveWorkspaceConversation"),
    );
    expect(screen.indexOf("<WorkspaceVoiceAura")).toBeLessThan(screen.indexOf("<Slot />"));
    expect(listBinding.match(/searchContent: sidebarSearch/gu)).toHaveLength(2);
  });

  it("keeps fields with specialized voice controls opted out", () => {
    expect(
      sourceHasJsxElement(ownerComposerEditor, "ComposerMarkdownInput", [
        "ref={composerInputRef}",
        'accessibilityLabel="Message Codex"',
      ]),
    ).toBe(true);
    expect(composerMarkdownInputWeb).toContain("voiceInput={false}");
    expect(
      sourceHasJsxElement(codeReviewEditor, "TextInput", ["voiceInput={false}", "autoFocus"]),
    ).toBe(true);
  });

  it("lets the composer inspect a complete paste before applying the message limit", () => {
    const composerStart = ownerComposerEditor.indexOf('accessibilityLabel="Message Codex"');
    const composerEnd = ownerComposerEditor.indexOf("/>", composerStart);
    expect(composerStart).toBeGreaterThan(-1);
    expect(ownerComposerEditor.slice(composerStart, composerEnd)).not.toContain("maxLength=");
    expect(ownerComposerEditor.slice(composerStart, composerEnd)).toContain(
      "largePasteThreshold: AUTO_ATTACH_PASTE_MIN_CHARS",
    );
    expect(ownerComposerEditor.slice(composerStart, composerEnd)).toContain(
      "onLargePaste: handleComposerLargePaste",
    );
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
    expect(largePasteModule).toContain("registeredView.findTextView()");
    expect(largePasteModule).toContain("private fun View.findTextView(): TextView?");
    expect(composerMarkdownInputNative).toContain("installLargePasteInterceptor(");
    expect(
      sourceHasJsxElement(composerMarkdownInputNative, "View", [
        "ref={root}",
        'testID="composer-input-layout"',
        "collapsable={false}",
      ]),
    ).toBe(true);
    expect(largePasteModule).not.toContain("MAX_RESOLVE_ATTEMPTS");
    expect(largePastePolicy).toContain("ContentInfoCompat.SOURCE_CLIPBOARD");
    expect(largePastePolicy).toContain("ContentInfoCompat.SOURCE_INPUT_METHOD");
    expect(largePastePolicy).toContain("shouldInterceptClipboardChunk");
  });

  it("keeps the conversation composer attached to every IME session", () => {
    expect(layout).toContain("<KeyboardStickyView enabled");
    expect(screen).not.toContain("composerTracksKeyboard");
    expect(screen).not.toContain("setComposerTracksKeyboard");
  });
});
