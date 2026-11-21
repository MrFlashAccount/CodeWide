import { processFile, type FileDiffMetadata } from "@pierre/diffs";

import type { CodeReviewPatch } from "../editorBridge";
import { canonicalPatch } from "./canonicalPatch.web";

/** Reads one recorded edit for line-aware display. Invalid recordings have no reliable anchors. */
export function readRecordedPatch(
  path: string,
  patch: CodeReviewPatch,
  cacheKey: string,
): { readonly metadata: FileDiffMetadata; readonly text: string } | null {
  try {
    const text = canonicalPatch(path, patch);
    const metadata = processFile(text, { cacheKey, throwOnError: true });
    return metadata === undefined ? null : { metadata, text };
  } catch {
    return null;
  }
}

/** Shows the exact recording as selectable text, including its original hunk headers. */
export function renderRawPatch(host: HTMLElement, diff: string): void {
  const label = document.createElement("div");
  label.className = "review-raw-patch-label";
  label.textContent = "Couldn’t parse this diff. Showing the recorded patch.";
  const raw = document.createElement("pre");
  raw.className = "review-raw-patch";
  raw.textContent = diff;
  host.replaceChildren(label, raw);
}
