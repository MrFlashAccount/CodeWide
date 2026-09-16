import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const screen = compactSource(
  readFileSync(new URL("../app/v1/_layout.tsx", import.meta.url), "utf8"),
);
const fullscreenOverlay = readFileSync(
  new URL("../src/ui/AppFullscreenOverlay.tsx", import.meta.url),
  "utf8",
);
const nativeCodeBlock = readFileSync(
  new URL("../src/rendering/NativeCodeBlock.tsx", import.meta.url),
  "utf8",
);
const nativeCodeView = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/rendering/NativeCodeBlockView.kt",
    import.meta.url,
  ),
  "utf8",
);
const asyncResourceStore = readFileSync(
  new URL("../src/rendering/async-resource-store.ts", import.meta.url),
  "utf8",
);

const ownerToolContent = compactSource(
  readFileSync(
    new URL("../src/features/conversation/protocol/ToolContent.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerFullContentViewer = compactSource(
  readFileSync(
    new URL("../src/features/conversation/content/FullContentViewer.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerCommandOutput = compactSource(
  readFileSync(
    new URL("../src/features/conversation/protocol/CommandOutput.tsx", import.meta.url),
    "utf8",
  ),
);

const overlayOwnership = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/overlayScrollOwnership.ts", import.meta.url),
    "utf8",
  ),
);

const frame = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationFrame.tsx", import.meta.url),
    "utf8",
  ),
);

const ownerProtocolBodyView = compactSource(
  readFileSync(
    new URL("../src/features/conversation/protocol/ProtocolBodyView.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerFullContentViewerBody = compactSource(
  readFileSync(
    new URL("../src/features/conversation/content/FullContentViewerBody.tsx", import.meta.url),
    "utf8",
  ),
);

describe("tool output presentation", () => {
  it("reports collapsed output in lines instead of characters", () => {
    expect(ownerToolContent).toContain(
      'const bodyLines = body === "" ? 0 : body.split("\\n").length;',
    );
    expect(ownerProtocolBodyView).toContain(
      '`Show more · ${bodyLines.toLocaleString()} ${bodyLines === 1 ? "line" : "lines"}`',
    );
    expect(ownerToolContent).not.toContain("`Show more · ${body.length.toLocaleString()} chars`");
  });

  it("keeps the fullscreen viewer outside recycled timeline rows", () => {
    const controls = ownerFullContentViewer.slice(
      ownerFullContentViewer.indexOf("function LargeContentControls"),
      ownerFullContentViewer.indexOf("function largeContentPresentation"),
    );

    expect(controls).toContain("useContext(LargeContentViewerContext)");
    expect(controls).toContain(
      "open?.({ pointer, reference, presentation: largeContentPresentation(pointer, reference), getTransferAccess, });",
    );
    expect(controls).not.toContain("useState");
    expect(controls).not.toContain("AppFullscreenModal");
    expect(controls).not.toContain("readPrivateAssetText");
    expect(ownerFullContentViewer).toContain("function LargeContentViewerHost");
    expect(ownerFullContentViewer).toContain("function LargeContentViewerSession");
    expect(ownerFullContentViewer).toContain("useEphemeralAsyncResource<PrivateAssetTextResult>(");
    expect(asyncResourceStore).toContain("const cacheKey = asyncResourceCacheKey(key, revision)");
    expect(compactSource(asyncResourceStore)).toContain("getAsyncResource<T>( key, revision");
    expect(frame).toContain("<LargeContentViewerHost>");
    expect(ownerFullContentViewer).toContain("navigation.openContent(request)");
    expect(ownerFullContentViewer).toContain("function LargeContentViewerSession");
    expect(ownerFullContentViewerBody).toContain('<View testID="full-content-viewer"');
    expect(controls).not.toContain("largeContentChunk");
    expect(ownerFullContentViewer).toContain(
      "async (_publish, signal) => await readPrivateAssetText(",
    );
    expect(ownerFullContentViewer).toContain("signal,");
  });

  it("does not manually reposition the timeline across fullscreen transitions", () => {
    expect(overlayOwnership).not.toContain("timelineOverlay");
    const freeze = overlayOwnership.indexOf("fullscreenScrollOwnership.willOpen(id)");
    expect(freeze).toBeGreaterThan(0);
    expect(
      overlayOwnership.indexOf("dismissComposerKeyboardForOverlay();", freeze),
    ).toBeGreaterThan(freeze);
    expect(fullscreenOverlay).toContain("binding.lifecycle?.willOpen?.(id)");
    expect(fullscreenOverlay).toContain("entry.lifecycle?.didOpen?.(entry.id)");
    expect(fullscreenOverlay).toContain("entry.lifecycle?.didClose?.(entry.id)");
  });

  it("keeps the complete chunk and supports native horizontal and vertical scrolling", () => {
    expect(ownerFullContentViewerBody).toContain(
      'variant={selection.presentation === "terminal" ? "terminal" : "code"}',
    );
    expect(ownerFullContentViewerBody).toContain(
      'selection.presentation === "terminal" ? stripTerminalControlSequences(selection.text) : selection.text',
    );
    expect(nativeCodeBlock).toContain("truncate = true");
    expect(nativeCodeBlock).toContain("truncate?: boolean;");
    expect(nativeCodeView).toContain("HorizontalScrollView(context)");
    expect(nativeCodeView).toContain("NestedScrollView(context)");
    expect(nativeCodeView).toContain("isHorizontalScrollBarEnabled = true");
    expect(nativeCodeView).toContain("isVerticalScrollBarEnabled = true");
    expect(ownerFullContentViewerBody).toContain("embeddedInParentScroll={false}");
    expect(nativeCodeBlock).toContain("embeddedInParentScroll = true");
    expect(nativeCodeBlock).toContain("embeddedInParentScroll={embeddedInParentScroll}");
    expect(nativeCodeView).toContain(
      "horizontalScroll.setOnTouchListener(if (value) embeddedHorizontalGestureListener else null)",
    );
  });

  it("presents command output as a terminal both inline and in full content", () => {
    expect(ownerCommandOutput).toContain('codeVariant="terminal"');
    expect(ownerFullContentViewer).toContain('reference.contentType.startsWith("text/x-ansi")');
    expect(ownerFullContentViewer).toContain('pointer.endsWith("/aggregatedOutput")');
  });
});
