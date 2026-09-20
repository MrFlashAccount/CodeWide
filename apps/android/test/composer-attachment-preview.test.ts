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

const ownerComposerFeature = readFileSync(new URL("../src/features/composer/ComposerFeature.tsx", import.meta.url), "utf8");
const ownerDraft = readFileSync(new URL("../src/features/composer/draft.ts", import.meta.url), "utf8");
const ownerQueueEdit = readFileSync(new URL("../src/features/composer/queueEdit.ts", import.meta.url), "utf8");

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

  it("reuses the composer attachment tray while editing a queued prompt", () => {
    const screen = readFileSync(new URL("../src/features/composer/ComposerFeature.tsx", import.meta.url), "utf8");
    const tray = readFileSync(new URL("../src/rendering/ComposerAttachmentTray.tsx", import.meta.url), "utf8");
    expect(screen.match(/<ComposerAttachmentTray/g)).toHaveLength(1);
    expect(tray).toContain('testID="composer-attachment-strip"');
    expect(ownerComposerFeature).toContain("scope={props.composerUploadScope}");
    expect(ownerDraft).toContain(
      "const attachments = queuedComposerEdit?.initialAttachments ?? storedAttachments",
    );
    expect(ownerDraft).toContain('`${composerScope}\\u0000queue-edit:${queuedComposerEdit.commandId}`');
    expect(ownerQueueEdit).toContain(
      "await onEditQueued(edit.commandId, text, editedAttachments)",
    );
    expect(ownerDraft).toContain("const draft = queuedComposerEdit?.initialText ?? storedDraft");
    expect(ownerComposerFeature).toContain('testID="queued-composer-edit-bar"');
    expect(screen).not.toContain('testID="queue-attachment-strip"');
    expect(tray).toContain("composerAttachmentSource(attachment)");
    expect(tray).toContain("useRegisterImagePreviewItem");
  });
});
