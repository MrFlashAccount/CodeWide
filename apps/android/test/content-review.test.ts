import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  normalizedReviewPoint,
  serializeContentReviewAttachment,
  type ContentReviewComment,
} from "../src/rendering/content-review";
import { contentReviewNativeModule } from "../src/rendering/content-review-native-module";

const target = { id: "answer-1", label: "Completed agent response", reference: "item-1" };
const contentReviewHost = readFileSync(new URL("../src/rendering/ContentReviewHost.tsx", import.meta.url), "utf8");

describe("content review", () => {
  it("keeps the fullscreen review composer attached to the Android keyboard", () => {
    expect(contentReviewHost).toContain("<KeyboardStickyView");
    expect(contentReviewHost).toContain("offset={{ closed: 0, opened: insets.bottom }}");
    expect(contentReviewHost).toMatch(/<KeyboardStickyView[\s\S]*<View style=\{styles\.composer\}>[\s\S]*<\/KeyboardStickyView>/u);
  });

  it("treats a missing native review module as an optional capability", () => {
    expect(contentReviewNativeModule(null)).toBeNull();
    expect(contentReviewNativeModule(undefined)).toBeNull();
    expect(contentReviewNativeModule({ install() {} })).toBeNull();
  });

  it("accepts a complete native review module", () => {
    const nativeModule = { install() {}, uninstall() {} };
    expect(contentReviewNativeModule(nativeModule)).toBe(nativeModule);
  });

  it("serializes selected text as an inline Markdown quote", () => {
    const comments: ContentReviewComment[] = [{
      id: "one",
      createdAt: 1,
      body: "Make this claim concrete.",
      anchor: {
        kind: "text",
        target,
        blockPath: "segment-0/paragraph-2",
        quote: "First line\nSecond line",
        start: 4,
        end: 26,
      },
    }];

    const attachment = serializeContentReviewAttachment(comments);
    expect(attachment).toContain("kind: codewide-content-review");
    expect(attachment).toContain("Block: `segment-0/paragraph-2` · rendered offsets 4–26");
    expect(attachment).toContain("> First line\n> Second line");
    expect(attachment).toContain("Make this claim concrete.");
  });

  it("serializes Mermaid coordinates and emits a diagram source once", () => {
    const source = "flowchart LR\n  A --> B";
    const comments: ContentReviewComment[] = [0.25, 0.75].map((x, index) => ({
      id: String(index),
      createdAt: index,
      body: `Comment ${index + 1}`,
      anchor: {
        kind: "mermaid" as const,
        target: { ...target, id: "document-1", label: "architecture.md", reference: "/repo/architecture.md" },
        diagramId: "segment-0/code-1",
        source,
        x,
        y: index === 0 ? -1 : 2,
      },
    }));

    const attachment = serializeContentReviewAttachment(comments);
    expect(attachment).toContain("Diagram: `segment-0/code-1`");
    expect(attachment).toContain("Point: **(25.0%, 0.0%)**");
    expect(attachment).toContain("Point: **(75.0%, 100.0%)**");
    expect(attachment.match(/```mermaid/gu)).toHaveLength(1);
  });

  it("clamps normalized points", () => {
    expect(normalizedReviewPoint(-0.5)).toBe(0);
    expect(normalizedReviewPoint(0.4)).toBe(0.4);
    expect(normalizedReviewPoint(3)).toBe(1);
  });
});
