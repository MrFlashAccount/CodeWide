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

  it("leaves sheet chrome to Material while retaining responsive content and lifecycle", () => {
    const appSheet = readSource("../src/ui/AppSheet.android.tsx");

    expect(appSheet).toContain('from "@expo/ui/jetpack-compose"');
    expect(appSheet).toContain('<Host colorScheme="dark"');
    expect(appSheet).not.toContain("containerColor=");
    expect(appSheet).not.toContain("contentColor=");
    expect(appSheet).not.toContain("scrimColor=");
    expect(appSheet).toContain("showDragHandle={contentProps.enablePanDownToClose ?? true}");
    expect(appSheet).toContain("<RNHostView matchContents={fitToContents}");
    expect(appSheet).toContain("!fitToContents && styles.fixedHostContent");
    expect(appSheet).toContain("fixedHostContent: { flexGrow: 1, height: 0 }");
    expect(appSheet).toContain('<ScrollView {...props} nestedScrollEnabled={props.nestedScrollEnabled ?? true} />');
    expect(appSheet).toContain("useWindowDimensions");
    expect(appSheet).not.toContain("maxWidth:");
    expect(appSheet).not.toContain("borderRadius:");
    expect(appSheet).not.toContain("backgroundColor:");
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
    expect(editor).toContain("loading && document === null && !sidebarOpen");
    expect(editor).not.toContain("visibleNotice");
    expect(editor).not.toContain("styles.notice");
    expect(editor).not.toContain("renderedRevision");
    expect(editor).not.toContain("loading || rendering");
  });

  it("uses the Android gesture-aware horizontal scroller for wide tables", () => {
    const richMarkdown = readSource("../src/rendering/RichMarkdown.tsx");
    const bubble = readSource("../src/rendering/Bubble.tsx");
    const documentPreview = readSource("../src/rendering/DocumentPreviewHost.tsx");

    expect(richMarkdown).toContain('ScrollView as GestureScrollView');
    expect(richMarkdown).toContain('Platform.OS === "android" ? GestureScrollView : ScrollView');
    expect(richMarkdown).toContain("<HorizontalScrollView");
    expect(richMarkdown).not.toContain("<Text selectable reviewBlockPath={reviewBlockPath}");
    expect(bubble).not.toContain("Gesture.LongPress()");
    expect(bubble).not.toContain("onLongPress");
    expect(bubble).not.toContain("<Pressable");
    expect(documentPreview).toContain('if (surface === "fullscreen")');
    expect(documentPreview).toContain("presentFullscreenDocument(fullscreen, request, downloadFile)");
    expect(documentPreview).toContain("<MarkdownDocumentView");
    expect(documentPreview).toContain("paddingBottom: spacing.sm");
  });
});
