import { describe, expect, it } from "vitest";

import {
  isQuickdrawDraftAttachment,
  imageAnnotationAttachment,
  quickdrawAttachmentName,
  quickdrawPngBytes,
  remoteAttachment,
} from "../src/data/quickdraw-attachment";

describe("QuickDraw composer attachment", () => {
  it("replaces the exact draft attachment rather than matching its name or making another card", () => {
    const first = { id: "first", rootId: "attachments", path: "first.png", name: "photo.png", kind: "image" as const };
    const second = { ...first, id: "second", path: "second.png" };
    const target = { scope: "server/thread", attachmentId: second.id };
    expect(imageAnnotationAttachment(target, target.scope, [first, second])).toBe(second);
    expect(() => imageAnnotationAttachment(target, "another/thread", [second])).toThrow("different draft");
    expect(() => imageAnnotationAttachment(target, target.scope, [first])).toThrow("no longer attached");
  });
  it("decodes the exported PNG data URL", () => {
    expect([...quickdrawPngBytes("data:image/png;base64,iVBORw==")]).toEqual([137, 80, 78, 71]);
  });

  it("rejects a non-PNG export", () => {
    expect(() => quickdrawPngBytes("data:image/jpeg;base64,iVBORw==")).toThrow("PNG image");
  });

  it("keeps editor state local when projecting the remote attachment", () => {
    const attachment = {
      id: "drawing-1",
      rootId: "attachments",
      path: "sessions/thread/files/drawing.png",
      name: "drawing.png",
      kind: "image" as const,
      editor: { kind: "quickdraw" as const, mode: "drawing" as const, snapshot: { document: { store: {} } }, revision: 42 },
    };

    expect(isQuickdrawDraftAttachment(attachment)).toBe(true);
    expect(remoteAttachment(attachment)).toEqual({
      id: "drawing-1",
      rootId: "attachments",
      path: "sessions/thread/files/drawing.png",
      name: "drawing.png",
      kind: "image",
    });
  });

  it("uses a stable filesystem-safe drawing name", () => {
    expect(quickdrawAttachmentName(new Date("2026-08-27T10:11:12.345Z"))).toBe("drawing-2026-08-27T10-11-12-345Z.png");
  });
});
