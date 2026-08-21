import { parseRichMarkdown } from "@codewide/rendering-core";

import { incrementDiagnosticMetric, operationalDiagnosticsEnabled, recordDiagnosticTiming } from "../data/operational-metrics";

export function parseDiagnosticRichMarkdown(source: string): ReturnType<typeof parseRichMarkdown> {
  if (!operationalDiagnosticsEnabled()) return parseRichMarkdown(source);
  const startedAt = performance.now();
  const parsed = parseRichMarkdown(source);
  recordDiagnosticTiming("markdown_parse_ms", performance.now() - startedAt);
  incrementDiagnosticMetric("markdown_parse_requests");
  incrementDiagnosticMetric("markdown_parse_chars", source.length);
  return parsed;
}
