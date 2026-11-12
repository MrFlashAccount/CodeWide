import { describe, expect, it } from "vitest";

import {
  contentReviewTextHighlights,
  normalizedReviewPoint,
  serializeContentReviewAttachment,
  type ContentReviewComment,
} from "../src/rendering/content-review";
import { contentReviewNativeModule } from "../src/rendering/content-review-native-module";

const target = { id: "answer-1", label: "Completed agent response", reference: "item-1" };

describe("content review", () => {
  it("attaches a video point with its timestamp and stable source reference", () => {
    const attachment = serializeContentReviewAttachment([
      {
        id: "video-pin",
        createdAt: 1,
        body: "The result becomes blurry here",
        anchor: {
          kind: "video",
          target: {
            id: "video-1",
            label: "comparison.mp4",
            reference: "scoped:attachments:comparison.mp4",
          },
          timeSeconds: 67.2346,
          x: 0.25,
          y: 0.75,
        },
      },
    ]);

    expect(attachment).toContain("Comment 1 · video point");
    expect(attachment).toContain("Time: **01:07.235**");
    expect(attachment).toContain("Point: **(25.0%, 75.0%)** from the video top-left.");
    expect(attachment).toContain("Reference: `scoped:attachments:comparison.mp4`");
    expect(attachment).toContain("The result becomes blurry here");
  });

  it("attaches image pin coordinates and comments without treating the image as a Mermaid diagram", () => {
    const image = { id: "image-1", label: "Screenshot", reference: "scoped:attachments:shot.png" };
    const attachment = serializeContentReviewAttachment([
      {
        id: "pin-1",
        createdAt: 1,
        body: "Move this button",
        anchor: { kind: "image", target: image, x: 0.25, y: 0.75 },
      },
      {
        id: "pin-2",
        createdAt: 2,
        body: "Keep the heading",
        anchor: { kind: "image", target: image, x: 0.5, y: 0.1 },
      },
    ]);
    expect(attachment).toContain("scoped:attachments:shot.png");
    expect(attachment).toContain("(25.0%, 75.0%)");
    expect(attachment).toContain("(50.0%, 10.0%)");
    expect(attachment).toContain("Move this button");
    expect(attachment).toContain("Keep the heading");
    expect(attachment).not.toContain("Mermaid");
    expect(attachment).not.toContain("undefined");
  });
  it("treats a missing native review module as an optional capability", () => {
    expect(contentReviewNativeModule(null)).toBeNull();
    expect(contentReviewNativeModule(undefined)).toBeNull();
    expect(contentReviewNativeModule({ install() {} })).toBeNull();
  });

  it("accepts a complete native review module", () => {
    const nativeModule = { install() {}, uninstall() {}, setHighlights() {} };
    expect(contentReviewNativeModule(nativeModule)).toBe(nativeModule);
  });

  it("keeps reviewed text ranges highlighted through the native TextView", () => {
    const anchors: ContentReviewComment["anchor"][] = [
      {
        kind: "text",
        target,
        blockPath: "segment-0/paragraph-2",
        quote: "first",
        start: 4,
        end: 9,
      },
      {
        kind: "text",
        target: { ...target, id: "other" },
        blockPath: "segment-0/paragraph-2",
        quote: "other",
        start: 0,
        end: 5,
      },
    ];
    expect(contentReviewTextHighlights(anchors, target.id, "segment-0/paragraph-2", 2)).toEqual([
      { start: 2, end: 7 },
    ]);
  });

  it("serializes selected text as an inline Markdown quote", () => {
    const comments: ContentReviewComment[] = [
      {
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
      },
    ];

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
        target: {
          ...target,
          id: "document-1",
          label: "architecture.md",
          reference: "/repo/architecture.md",
        },
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

  it("serializes whole-response reviews without duplicating response text", () => {
    const comments: ContentReviewComment[] = [
      {
        id: "response",
        createdAt: 1,
        body: "Tighten the conclusion.",
        anchor: { kind: "response", target },
      },
    ];

    const attachment = serializeContentReviewAttachment(comments);
    expect(attachment).toContain("Comment 1 · whole response");
    expect(attachment).toContain("Scope: **entire response**");
    expect(attachment).toContain("Tighten the conclusion.");
  });

  it("clamps normalized points", () => {
    expect(normalizedReviewPoint(-0.5)).toBe(0);
    expect(normalizedReviewPoint(0.4)).toBe(0.4);
    expect(normalizedReviewPoint(3)).toBe(1);
  });
});
