import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const fullscreenOverlay = readFileSync(new URL("../src/ui/AppFullscreenOverlay.tsx", import.meta.url), "utf8");
const nativeCodeBlock = readFileSync(new URL("../src/rendering/NativeCodeBlock.tsx", import.meta.url), "utf8");
const nativeCodeView = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/rendering/NativeCodeBlockView.kt", import.meta.url), "utf8");

describe("tool output presentation", () => {
  it("reports collapsed output in lines instead of characters", () => {
    expect(screen).toContain('const bodyLines = body === "" ? 0 : body.split("\\n").length;');
    expect(screen).toContain('`Show more · ${bodyLines.toLocaleString()} ${bodyLines === 1 ? "line" : "lines"}`');
    expect(screen).not.toContain('`Show more · ${body.length.toLocaleString()} chars`');
  });

  it("keeps the fullscreen viewer outside recycled timeline rows", () => {
    const controlsStart = screen.indexOf("function LargeContentControls");
    const controlsEnd = screen.indexOf("function FullContentViewer", controlsStart);
    const controls = screen.slice(controlsStart, controlsEnd);

    expect(controls).toContain("useContext(LargeContentViewerContext)");
    expect(controls).toContain("open?.({ pointer, reference, presentation: largeContentPresentation(pointer, reference), getTransferAccess })");
    expect(controls).not.toContain("useState");
    expect(controls).not.toContain("AppFullscreenModal");
    expect(controls).not.toContain("readPrivateAssetText");
    expect(screen).toContain("function LargeContentViewerHost");
    expect(screen).toContain("function LargeContentViewerSession");
    expect(screen).toContain("<LargeContentViewerHost>");
    expect(screen).toContain("fullscreenOverlay.present(({ close }) => (");
    expect(screen).toContain('<View testID="full-content-viewer"');
    expect(controls).not.toContain("largeContentChunk");
    expect(screen).toContain('signal: controller.signal');
  });

  it("guards the timeline anchor across the native fullscreen transition", () => {
    expect(screen).toContain("timelineOverlay.begin(id)");
    expect(screen).toContain("didOpen: () => timelineOverlay.restore(false)");
    expect(screen).toContain("didClose: (id) => timelineOverlay.end(id)");
    expect(fullscreenOverlay).toContain("binding.lifecycle?.willOpen?.(id)");
    expect(fullscreenOverlay).toContain("entry.lifecycle?.didOpen?.(entry.id)");
    expect(fullscreenOverlay).toContain("entry.lifecycle?.didClose?.(entry.id)");
  });

  it("keeps the complete chunk and supports native horizontal and vertical scrolling", () => {
    expect(screen).toContain('variant={selection.presentation === "terminal" ? "terminal" : "code"}');
    expect(screen).toContain('selection.presentation === "terminal" ? stripTerminalControlSequences(selection.text) : selection.text');
    expect(nativeCodeBlock).toContain("truncate = true");
    expect(nativeCodeBlock).toContain("truncate?: boolean;");
    expect(nativeCodeView).toContain("HorizontalScrollView(context)");
    expect(nativeCodeView).toContain("NestedScrollView(context)");
    expect(nativeCodeView).toContain("isHorizontalScrollBarEnabled = true");
    expect(nativeCodeView).toContain("isVerticalScrollBarEnabled = true");
  });

  it("presents command output as a terminal both inline and in full content", () => {
    expect(screen).toContain('codeVariant="terminal"');
    expect(screen).toContain('reference.contentType.startsWith("text/x-ansi")');
    expect(screen).toContain('pointer.endsWith("/aggregatedOutput")');
  });
});
