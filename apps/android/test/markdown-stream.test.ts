import { describe, expect, it } from "vitest";

import {
  MAX_MARKDOWN_SEGMENT_CHARS,
  parseRichMarkdown,
  projectCompleteMarkdown,
  projectMarkdownStream,
} from "@codewide/rendering-core";
import { markdownLineTarget } from "../src/rendering/document-preview";

describe("incremental agent Markdown projection", () => {
  it("preserves an unbounded document without a user-visible cut", () => {
    const source = Array.from({ length: 12_000 }, (_, index) => `Paragraph ${index}\n\n`).join("");
    let remainder = "";
    const segments: string[] = [];
    for (let offset = 0; offset < source.length; offset += 8_191) {
      const end = Math.min(source.length, offset + 8_191);
      const result = projectMarkdownStream(remainder, source.slice(offset, end), end === source.length);
      segments.push(...result.segments);
      remainder = result.remainder;
    }

    expect(remainder).toBe("");
    expect(segments.join("")).toBe(source);
    expect(Math.max(...segments.map((segment) => segment.length))).toBeLessThanOrEqual(MAX_MARKDOWN_SEGMENT_CHARS + 1);
    for (const segment of segments) expect(parseRichMarkdown(segment).truncated).toBe(false);
  });

  it("bounds a huge fenced block by closing and reopening synthetic fences", () => {
    const source = `\`\`\`text\n${"x".repeat(MAX_MARKDOWN_SEGMENT_CHARS * 3)}\n\`\`\`\n`;
    const result = projectMarkdownStream("", source, true);
    const segments = [...result.segments, ...(result.remainder === "" ? [] : [result.remainder])];

    expect(result.remainder).toBe("");
    expect(segments.length).toBeGreaterThan(1);
    expect(Math.max(...segments.map((segment) => segment.length))).toBeLessThan(MAX_MARKDOWN_SEGMENT_CHARS + 64);
    for (const segment of segments) expect(parseRichMarkdown(segment).truncated).toBe(false);
  });

  it("maps a source line through synthetic fence segments", () => {
    const sourceLines = Array.from({ length: 300 }, (_, index) => `line-${index}-${"x".repeat(900)}`);
    const source = `\`\`\`text\n${sourceLines.join("\n")}\n\`\`\`\n`;
    const segments = projectCompleteMarkdown(source);
    const targetSourceLine = 175;
    const target = markdownLineTarget(source, segments, targetSourceLine);

    expect(target).not.toBeNull();
    const renderedLine = segments[target!.segmentIndex]!.split("\n")[target!.line - 1];
    expect(renderedLine).toBe(sourceLines[targetSourceLine - 2]);
  });

  it("projects a completed inline agent answer through bounded parser inputs", () => {
    const source = `${"Long answer paragraph. ".repeat(90_000)}\n\nDone.`;
    const segments = projectCompleteMarkdown(source);

    expect(segments.join("")).toBe(source);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) expect(parseRichMarkdown(segment).truncated).toBe(false);
  });
});
