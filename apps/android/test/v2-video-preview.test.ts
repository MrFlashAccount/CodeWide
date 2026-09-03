import { describe, expect, it } from "vitest";

import {
  isVideoAttachment,
  parseVideoPreviewRoute,
} from "../src/v2/features/attachments/videoPreview";

const BASE_ROUTE = {
  attachmentId: "attachment-1",
  mediaType: "video/mp4",
  name: "recording.mp4",
  savedServerId: "server-1",
  sourceUri: "file:///data/user/0/dev.codewide.app/cache/recording.mp4",
  threadId: "thread-1",
};

describe("V2 video preview", () => {
  it.each([
    ["capture.mp4", "application/octet-stream"],
    ["capture.WEBM?download=1", ""],
    ["capture.bin", "video/mp4; charset=binary"],
  ])("recognizes supported video %s", (name, mediaType) => {
    expect(parseVideoPreviewRoute({ ...BASE_ROUTE, mediaType, name }).ok).toBe(true);
  });

  it.each(["capture.mov", "capture.webm"])(
    "classifies remote octet-stream %s for the active attachment preview",
    (name) => {
      expect(isVideoAttachment(name, "application/octet-stream")).toBe(true);
    },
  );

  it("rejects a regular file", () => {
    expect(
      parseVideoPreviewRoute({ ...BASE_ROUTE, mediaType: "application/pdf", name: "report.pdf" }),
    ).toEqual({ message: "This attachment is not a supported video", ok: false });
  });

  it.each(["https://codex.garin.dev/video.mp4", "http://127.0.0.1/video.mp4"])(
    "rejects remote source %s so credentials cannot enter navigation",
    (sourceUri) => {
      expect(parseVideoPreviewRoute({ ...BASE_ROUTE, sourceUri })).toEqual({
        message: "Video must be materialized in private local storage before playback",
        ok: false,
      });
    },
  );

  it("accepts a server-qualified local video", () => {
    expect(parseVideoPreviewRoute(BASE_ROUTE)).toEqual({
      model: {
        attachmentId: "attachment-1",
        mediaType: "video/mp4",
        name: "recording.mp4",
        savedServerId: "server-1",
        source: { uri: "file:///data/user/0/dev.codewide.app/cache/recording.mp4" },
        threadId: "thread-1",
      },
      ok: true,
    });
  });

  it("rejects array parameters from an ambiguous deep link", () => {
    expect(parseVideoPreviewRoute({ ...BASE_ROUTE, attachmentId: ["one", "two"] })).toEqual({
      message: "Video identity is invalid",
      ok: false,
    });
  });
});
