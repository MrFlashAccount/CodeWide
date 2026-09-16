import { readFileSync } from "node:fs";

export const secureCryptoPolyfill = readFileSync(
  new URL("../../src/polyfills/secure-crypto.ts", import.meta.url),
  "utf8",
);
export const nativeCodeBlock = readFileSync(
  new URL("../../src/rendering/NativeCodeBlock.tsx", import.meta.url),
  "utf8",
);
export const nativeCodeBlockHost = readFileSync(
  new URL("../../src/presentation/nativeCodeBlockHost.tsx", import.meta.url),
  "utf8",
);
export const screen = readFileSync(
  new URL("../../app/v1/_layout.tsx", import.meta.url),
  "utf8",
);
export const nativeShimmerTextHost = readFileSync(
  new URL("../../src/presentation/text/nativeShimmerText.tsx", import.meta.url),
  "utf8",
);
export const richMarkdown = readFileSync(
  new URL("../../src/rendering/RichMarkdown.tsx", import.meta.url),
  "utf8",
);
export const bubble = readFileSync(
  new URL("../../src/rendering/Bubble.tsx", import.meta.url),
  "utf8",
);
export const documentPreviewHost = readFileSync(
  new URL("../../src/rendering/DocumentPreviewHost.tsx", import.meta.url),
  "utf8",
);
export const documentPreview = readFileSync(
  new URL("../../src/rendering/document-preview.ts", import.meta.url),
  "utf8",
);
export const mermaidNative = readFileSync(
  new URL("../../src/rendering/MermaidDiagram.native.tsx", import.meta.url),
  "utf8",
);
export const mermaidWeb = readFileSync(
  new URL("../../src/rendering/MermaidDiagram.web.tsx", import.meta.url),
  "utf8",
);
export const imagePreviewHost = readFileSync(
  new URL("../../src/rendering/ImagePreviewHost.tsx", import.meta.url),
  "utf8",
);
export const reducedMotionStore = readFileSync(
  new URL("../../src/rendering/reduced-motion-store.ts", import.meta.url),
  "utf8",
);
export const privateImageCache = readFileSync(
  new URL("../../src/rendering/private-image-cache.native.ts", import.meta.url),
  "utf8",
);
export const privateImageUri = readFileSync(
  new URL("../../src/rendering/use-private-image-uri.ts", import.meta.url),
  "utf8",
);
export const timelineList = readFileSync(
  new URL("../../src/rendering/ThreadTimelineList.tsx", import.meta.url),
  "utf8",
);
export const changeMenu = readFileSync(
  new URL("../../src/rendering/change-menu.ts", import.meta.url),
  "utf8",
);
export const codeReviewEditor = readFileSync(
  new URL("../../src/rendering/CodeReviewEditor.native.tsx", import.meta.url),
  "utf8",
);
export const codeReviewRuntime = readFileSync(
  new URL("../../code-review-editor/entry.ts", import.meta.url),
  "utf8",
);
export const wirelessDev = readFileSync(
  new URL("../../../../scripts/android-fast-refresh.sh", import.meta.url),
  "utf8",
);
