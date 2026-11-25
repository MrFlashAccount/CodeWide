import { projectCompleteMarkdown } from "@codewide/rendering-core";

import { parseDiagnosticRichMarkdown } from "./diagnostic-markdown";
import { segmentNeedsAvailableWidth, type ParsedMarkdownSegment } from "./rich-markdown-layout";

/** Render inputs and the enclosing width policy for one settled document. */
export type PreparedDocument = {
  readonly fill: boolean;
  readonly segments: readonly ParsedMarkdownSegment[];
};

/** Parses bounded segments once and shares their trees between width selection and rendering. */
export function prepareCompleteMarkdown(source: string): PreparedDocument {
  const segments = projectCompleteMarkdown(source).map((segment) => ({
    parsed: parseDiagnosticRichMarkdown(segment),
    source: segment,
  }));
  return { fill: segments.some(segmentNeedsAvailableWidth), segments };
}
