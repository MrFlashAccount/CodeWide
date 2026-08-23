import { parseRichMarkdown } from "@codewide/rendering-core";

import { incrementDiagnosticMetric, operationalDiagnosticsEnabled, recordDiagnosticTiming } from "../data/operational-metrics";
import { recordActiveThreadNavigationMeasure } from "../data/thread-navigation-metrics";

export function parseDiagnosticRichMarkdown(source: string): ReturnType<typeof parseRichMarkdown> {
  if (!operationalDiagnosticsEnabled()) return parseRichMarkdown(source);
  const startedAt = performance.now();
  const parsed = parseRichMarkdown(source);
  const durationMs = performance.now() - startedAt;
  recordDiagnosticTiming("markdown_parse_ms", durationMs);
  recordActiveThreadNavigationMeasure("parse_markdown", durationMs, { values: { charCount: source.length } });
  incrementDiagnosticMetric("markdown_parse_requests");
  incrementDiagnosticMetric("markdown_parse_chars", source.length);
  return parsed;
}
