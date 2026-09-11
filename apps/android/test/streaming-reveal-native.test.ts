import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { compactSource } from "./source-contract";

it("invalidates native text display lists, not only the enclosing View", () => {
  const view = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/rendering/NativeStreamingRevealView.kt", import.meta.url), "utf8");
  // Android's selectable TextView/Editor cache glyph paint separately. The
  // UpdateAppearance notification is the public span path for dirtying it.
  expect(view).toContain("paintRevision = object : UpdateAppearance");
  expect(view).toContain("text?.setSpan(paintRevision");
  expect(view).toContain("target.invalidatePaint()");
  expect(view).not.toContain("StreamingRevealHistory");
});

it("marks completed text as static rather than replaying its streaming animation", () => {
  const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));
  const surface = readFileSync(new URL("../src/rendering/StreamingRevealSurface.tsx", import.meta.url), "utf8");
  expect(screen).toContain('reviewTarget={reviewTarget} streamKey={block.key}');
  expect(screen).toContain('animateNew={false}');
  expect(surface).toContain("NativeSurface !== null && animateNew && !reduceMotion");
  expect(surface).toContain('testID="streaming-reveal-fallback"');
});

it("settles recovered live text before enabling animation for new deltas", () => {
  const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));
  const markdown = readFileSync(new URL("../src/rendering/RichMarkdown.tsx", import.meta.url), "utf8");
  expect(screen).toContain('liveTextRecovery={chatSnapshot.backendRefreshing}');
  expect(screen).toContain('const animateLiveUpdates = server?.status === "live" && !liveTextRecovery;');
  expect(screen).toContain('animateNew={animateLiveUpdates}');
  expect(screen).toContain('animate={animateNew && motionAllowed && turnStatus === "inProgress"}');
  expect(screen).toContain('streaming animateStreaming={animateNew}');
  expect(markdown).toContain('animateStreaming = streaming');
  expect(markdown).toContain('parseDiagnosticRichMarkdown(source, !streaming)');
  expect(markdown).toContain('<RichMarkdownRevealContext.Provider value={animateStreaming}>');
});

it("resets the native reveal baseline on navigation, recycling and backgrounding", () => {
  const view = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/rendering/NativeStreamingRevealView.kt", import.meta.url), "utf8");
  expect(view).toContain("session.createState(current.length, animateNew)");
  expect(view).toContain("session.didPresentText()");
  expect(view).toContain("session.reset()");
  expect(view).toContain("onWindowVisibilityChanged");
  expect(view).toContain("onVisibilityAggregated");
  expect(view).toContain("val animate = animateNew && !reduceMotion");
});
