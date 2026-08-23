import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { documentPreviewSurface } from "../src/rendering/document-preview";

const readSource = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  "utf8",
);

describe("document preview surfaces", () => {
  it("keeps interactive documents out of the bottom sheet", () => {
    expect(documentPreviewSurface("markdown")).toBe("fullscreen");
    expect(documentPreviewSurface("html")).toBe("fullscreen");
    expect(documentPreviewSurface("text")).toBe("sheet");
  });

  it("keeps responsive sheet geometry on the native Expo UI sheet", () => {
    const appSheet = readSource("../src/ui/AppSheet.android.tsx");

    expect(appSheet).toContain('from "@expo/ui/jetpack-compose"');
    expect(appSheet).toContain('<Host colorScheme="dark"');
    expect(appSheet).toContain("containerColor={colors.surfaceContainerHigh}");
    expect(appSheet).toContain("contentColor={colors.text}");
    expect(appSheet).toContain("scrimColor={colors.scrim}");
    expect(appSheet).toContain("<RNHostView matchContents={fitToContents}");
    expect(appSheet).toContain("!fitToContents && styles.fixedHostContent");
    expect(appSheet).toContain("fixedHostContent: { flexGrow: 1, height: 0 }");
    expect(appSheet).toContain("<ScrollView nestedScrollEnabled={nestedScrollEnabled}");
    expect(appSheet).toContain("const SHEET_MAX_WIDTH = 580");
    expect(appSheet).toContain("const detached = contentProps.detached ?? true");
    expect(appSheet).toContain("useWindowDimensions");
    expect(appSheet).toContain("maxWidth: SHEET_MAX_WIDTH");
    expect(appSheet).toContain("borderRadius: radii.composer");
    expect(appSheet).toContain("backgroundColor: colors.surfaceContainerHigh");
    expect(appSheet).toContain("sheetRef.current");
    expect(appSheet).toContain("sheetRef.current?.hide()");
    expect(appSheet).toContain("onOpenChange(false)");
    expect(appSheet).toContain("<RecoverableRenderBoundary");
    expect(appSheet).toContain('label="Bottom sheet content"');
    expect(appSheet).toContain('resetKey={isOpen ? "open" : "closed"}');
  });

  it("does not overlay diff fallback notices or late render spinners on code", () => {
    const editor = readSource("../src/rendering/CodeReviewEditor.native.tsx");

    expect(editor).not.toContain("showInitialLoading");
    expect(editor).not.toContain("<ActivityIndicator");
    expect(editor).not.toContain("visibleNotice");
    expect(editor).not.toContain("styles.notice");
    expect(editor).not.toContain("renderedRevision");
    expect(editor).not.toContain("loading || rendering");
  });

  it("uses the Android gesture-aware horizontal scroller for wide tables", () => {
    const richMarkdown = readSource("../src/rendering/RichMarkdown.tsx");
    const documentPreview = readSource("../src/rendering/DocumentPreviewHost.tsx");

    expect(richMarkdown).toContain('ScrollView as GestureScrollView');
    expect(richMarkdown).toContain('Platform.OS === "android" ? GestureScrollView : ScrollView');
    expect(richMarkdown).toContain("<HorizontalScrollView");
    expect(documentPreview).toContain('if (surface === "fullscreen")');
    expect(documentPreview).toContain("presentFullscreenDocument(fullscreen, request, downloadFile)");
    expect(documentPreview).toContain("<ScrollView");
    expect(documentPreview).toContain("paddingBottom: spacing.sm");
  });
});
