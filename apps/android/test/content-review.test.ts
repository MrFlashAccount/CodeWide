import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  contentReviewTextHighlights,
  normalizedReviewPoint,
  serializeContentReviewAttachment,
  type ContentReviewComment,
} from "../src/rendering/content-review";
import { contentReviewNativeModule } from "../src/rendering/content-review-native-module";
import { compactSource, sourceHasJsxElement } from "./source-contract";

const target = { id: "answer-1", label: "Completed agent response", reference: "item-1" };
const contentReviewHost = readFileSync(
  new URL("../src/rendering/ContentReviewHost.tsx", import.meta.url),
  "utf8",
);
const reviewableText = readFileSync(
  new URL("../src/rendering/ReviewableText.native.tsx", import.meta.url),
  "utf8",
);
const documentPreview = readFileSync(
  new URL("../src/rendering/DocumentPreviewHost.tsx", import.meta.url),
  "utf8",
);
const screen = compactSource(
  readFileSync(new URL("../app/v1/_layout.tsx", import.meta.url), "utf8"),
);
const selectionModule = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/rendering/ContentReviewSelectionModule.kt",
    import.meta.url,
  ),
  "utf8",
);
const mermaidDiagram = readFileSync(
  new URL("../src/rendering/MermaidDiagram.native.tsx", import.meta.url),
  "utf8",
);
const mermaidRenderer = readFileSync(
  new URL("../android/app/src/main/assets/mermaid-renderer.html", import.meta.url),
  "utf8",
);

const attachmentDocument = readFileSync(
  new URL("../src/features/attachments/AttachmentDocumentPreview.tsx", import.meta.url),
  "utf8",
);
const reviewAdmission = readFileSync(
  new URL("../src/features/composer/attachments/reviewAdmission.ts", import.meta.url),
  "utf8",
);
const reviewFeature = readFileSync(
  new URL("../src/features/review/ReviewFeature.tsx", import.meta.url),
  "utf8",
);

const ownerAgentResponseMarkdown = compactSource(
  readFileSync(
    new URL("../src/features/conversation/content/AgentResponseMarkdown.tsx", import.meta.url),
    "utf8",
  ),
);

const overlays = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationOverlayContent.tsx", import.meta.url),
    "utf8",
  ),
);

describe("content review", () => {
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
  it("keeps review input inline with the currently visible content", () => {
    expect(contentReviewHost).toContain("<ContentReviewKeyboardDock>");
    expect(contentReviewHost).toContain("paddingBottom: Math.max(spacing.sm, insets.bottom)");
    expect(contentReviewHost).toContain("<InlineContentReviewComposer");
    expect(contentReviewHost).not.toContain("useAppFullscreenOverlay");
    expect(contentReviewHost).not.toContain("resumeTray");
    expect(
      sourceHasJsxElement(documentPreview, "ContentReviewComposer", [
        "targetId={markdownReviewTarget.id}",
        'anchorKind="text"',
      ]),
    ).toBe(true);
    expect(overlays).toContain('<ContentReviewComposer targetPrefix="agent-response:" />');
    expect(compactSource(attachmentDocument)).toMatch(
      /<ContentReviewComposer(?=[^>]*anchorKind="text")(?=[^>]*targetId=\{`markdown-document:\$\{document\.request\.path\}`\})[^>]*\/>/u,
    );
    expect(
      sourceHasJsxElement(mermaidDiagram, "ContentReviewComposer", [
        "targetId={reviewTarget.id}",
        'anchorKind="mermaid"',
        "diagramId={diagramId}",
      ]),
    ).toBe(true);
  });

  it("keeps Mermaid review state and saved comments inside its fullscreen surface", () => {
    expect(mermaidDiagram).toContain("active={annotating}");
    expect(mermaidDiagram).toContain('color={annotating ? "#ffffff" : colors.textMuted}');
    expect(mermaidDiagram).toContain("reviewPoints={reviewPoints}");
    expect(
      sourceHasJsxElement(mermaidDiagram, "ContentReviewComments", [
        "targetId={reviewTarget.id}",
        "diagramId={diagramId}",
        'presentation="overlay"',
      ]),
    ).toBe(true);
    expect(mermaidRenderer).toContain("window.diagramSetReviewPoints = function (points)");
    expect(mermaidRenderer).toContain("pending ? '#ffffff' : '#b794f6'");
  });

  it("exposes saved review comments on completed responses and Markdown documents", () => {
    expect(contentReviewHost).toContain("export function ContentReviewComments");
    expect(ownerAgentResponseMarkdown).toContain(
      "<ContentReviewComments targetId={reviewTarget.id} />",
    );
    expect(attachmentDocument).toContain(
      "<ContentReviewComments targetId={`markdown-document:${document.request.path}`} />",
    );
    expect(
      sourceHasJsxElement(documentPreview, "ContentReviewComments", [
        "targetId={markdownReviewTarget.id}",
        'presentation="overlay"',
      ]),
    ).toBe(true);
  });

  it("updates one regular Markdown attachment as comments are saved", () => {
    expect(contentReviewHost).toContain("const attachmentId = await runtime.attach(markdown)");
    expect(contentReviewHost).toContain(
      "attachmentByScopeRef.current.set(current.scope, attachmentId)",
    );
    expect(reviewAdmission).toContain("candidate.id !== previousAttachmentId");
    expect(reviewFeature).toContain("attachmentId: contentReviewAttachmentId");
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
    expect(reviewableText).toContain(
      "nativeModule?.setHighlights?.(reactTag, token, reviewHighlights)",
    );
    expect(selectionModule).toContain("ReviewHighlightSpan");
    expect(selectionModule).toContain("REVIEW_HIGHLIGHT_COLOR");
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
