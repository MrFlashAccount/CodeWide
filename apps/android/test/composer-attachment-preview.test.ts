import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { composerAttachmentPreviewKind, composerAttachmentSource } from "../src/rendering/composer-attachment-preview";

const image = {
  id: "image-1",
  rootId: "attachments",
  path: "sessions/thread/files/shot.png",
  name: "shot.png",
  kind: "image" as const,
};

describe("composer attachment preview", () => {
  it("preserves the scoped companion reference", () => {
    expect(composerAttachmentSource(image)).toEqual({
      kind: "scoped",
      rootId: "attachments",
      path: "sessions/thread/files/shot.png",
    });
  });

  it("routes images and documents into the shared preview kinds", () => {
    expect(composerAttachmentPreviewKind(image)).toBe("image");
    expect(composerAttachmentPreviewKind({ ...image, id: "markdown-1", name: "review.md", path: "sessions/thread/files/review.md", kind: "file" })).toBe("markdown");
  });

  it("uses one compact renderer in the composer and queue editor", () => {
    const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
    expect(screen.match(/<CompactAttachmentStrip/g)).toHaveLength(2);
    expect(screen).toContain('testID="composer-attachment-strip"');
    expect(screen).toContain('testID="queue-attachment-strip"');
    expect(screen).toContain("source: composerAttachmentSource(attachment)");
    expect(screen).toContain("useRegisterImagePreviewItem(resolvedSource === null ? null : groupId, previewItem)");
  });
});
