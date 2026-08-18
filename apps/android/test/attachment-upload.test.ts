import { describe, expect, it } from "vitest";

import { ATTACHMENT_ROOT_ID, attachmentUploadPath } from "../src/data/attachment-upload";

describe("attachment upload", () => {
  it("uses the companion-owned attachment root and preserves a safe basename", () => {
    expect(ATTACHMENT_ROOT_ID).toBe("attachments");
    expect(attachmentUploadPath("thread-123", "report final.md", 1_000, "abc123")).toBe(
      "sessions/thread-123/files/rs-abc123-report final.md",
    );
  });

  it("removes path traversal and control characters from the selected name", () => {
    const path = attachmentUploadPath("thread-123", "../bad\\name\n.png", 0, "x/y");
    expect(path).toBe("sessions/thread-123/files/0-xy-.._bad_name_.png");
    expect(path.split("/").at(-1)).not.toContain("/");
    expect(path).not.toContain("\\");
    expect(path).not.toContain("\n");
  });

  it("refuses to create an attachment outside a concrete thread", () => {
    expect(() => attachmentUploadPath("../other", "photo.png")).toThrow("valid thread ID");
    expect(() => attachmentUploadPath("", "photo.png")).toThrow("valid thread ID");
  });
});
