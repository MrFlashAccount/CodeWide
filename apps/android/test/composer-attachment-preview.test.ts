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
});
