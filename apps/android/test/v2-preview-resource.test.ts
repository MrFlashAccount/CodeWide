import { fromByteArray } from "base64-js";
import { describe, expect, it, vi } from "vitest";
import type { V2Attachment } from "@codewide/sync-client/v2";

import type { PreviewTransport } from "../src/v2/application/preview/previewTransport";
import { isolatedPreviewHtml } from "../src/v2/application/preview/isolatedHtml";
import { PreviewResource } from "../src/v2/application/resources/previewResource";
import { AttachmentPreviewSelections } from "../src/v2/application/preview/attachmentPreviewSelection";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import {
  MAX_DOCUMENT_PREVIEW_BYTES,
  attachmentPreviewMode,
  decodePreviewDocument,
} from "../src/v2/features/attachments/attachmentPreviewModel";
import { attachmentForReference } from "../src/v2/features/attachments/attachmentReference";
import { createAttachmentRenderingCapabilities } from "../src/v2/features/attachments/createAttachmentRenderingCapabilities";
import { workspaceFileReference } from "../src/v2/features/attachments/workspaceFileReference";

describe("V2 preview resource", () => {
  it("reads bounded documents through the qualified preview transport", async () => {
    const server = savedServerId("server-1");
    const read = vi.fn<PreviewTransport["read"]>().mockResolvedValue({
      bodyBase64: "aGVsbG8=",
      contentType: "text/plain",
    });
    const stream = vi.fn<PreviewTransport["stream"]>();
    const resource = new PreviewResource(
      previewTransport({ read, stream }),
      server,
      "/v2/files/preview?path=a",
      "document",
    );

    await settled(resource);

    expect(read).toHaveBeenCalledExactlyOnceWith(server, "/v2/files/preview?path=a");
    expect(stream).not.toHaveBeenCalled();
    expect(resource.snapshot()).toEqual({
      status: "ready",
      value: {
        document: { bodyBase64: "aGVsbG8=", contentType: "text/plain" },
        stream: null,
      },
    });
  });

  it("streams media without materializing it in JavaScript", async () => {
    const server = savedServerId("server-2");
    const read = vi.fn<PreviewTransport["read"]>();
    const stream = vi.fn<PreviewTransport["stream"]>().mockResolvedValue({
      headers: { Authorization: "Bearer opaque" },
      uri: "http://127.0.0.1:41000/v2/media/media-1",
    });
    const resource = new PreviewResource(
      previewTransport({ read, stream }),
      server,
      "https://files/video.mp4",
      "video",
    );

    await settled(resource);

    expect(stream).toHaveBeenCalledExactlyOnceWith(server, "https://files/video.mp4", "video");
    expect(read).not.toHaveBeenCalled();
    expect(resource.snapshot().value.stream?.uri).toContain("/v2/media/media-1");
  });

  it("delegates materialize, save, and export with the same qualified file request", async () => {
    const server = savedServerId("server-3");
    const local = { contentType: "image/png", name: "image.png", uri: "file:///image.png" };
    const materialize = vi.fn<PreviewTransport["materialize"]>().mockResolvedValue(local);
    const save = vi.fn<PreviewTransport["save"]>().mockResolvedValue(local);
    const exportFile = vi.fn<PreviewTransport["exportFile"]>().mockResolvedValue(local);
    const resource = new PreviewResource(
      previewTransport({ exportFile, materialize, save }),
      server,
      "/v2/files/preview?path=image.png",
      "image",
    );

    await Promise.all([
      resource.materialize("image.png", "image/png"),
      resource.save("image.png", "image/png"),
      resource.exportFile("image.png", "image/png"),
    ]);

    const request = {
      contentType: "image/png",
      mode: "image",
      name: "image.png",
      savedServerId: server,
      sourceUrl: "/v2/files/preview?path=image.png",
    };
    expect(materialize).toHaveBeenCalledExactlyOnceWith(request);
    expect(save).toHaveBeenCalledExactlyOnceWith(request);
    expect(exportFile).toHaveBeenCalledExactlyOnceWith(request);
  });

  it("exposes a retryable access error and recovers on refresh", async () => {
    const stream = vi
      .fn<PreviewTransport["stream"]>()
      .mockRejectedValueOnce(new Error("Preview returned 401"))
      .mockResolvedValueOnce({ headers: null, uri: "file:///retry.png" });
    const resource = new PreviewResource(
      previewTransport({ stream }),
      savedServerId("server-4"),
      "/v2/files/preview?path=retry.png",
      "image",
    );

    await settled(resource);
    expect(resource.snapshot()).toMatchObject({
      message: "Attachment access expired. Try again to reconnect securely.",
      status: "error",
    });

    await resource.refresh();
    expect(resource.snapshot()).toEqual({
      status: "ready",
      value: { document: null, stream: { headers: null, uri: "file:///retry.png" } },
    });
  });
});

describe("V2 attachment preview model", () => {
  it.each([
    [attachment("README.MDX", "application/octet-stream"), "document"],
    [attachment("report.html", "text/html"), "document"],
    [attachment("photo.PNG", "application/octet-stream"), "image"],
    [attachment("capture.webm", "application/octet-stream"), "video"],
    [attachment("report.pdf", "application/pdf"), "web"],
  ] as const)("classifies $0.name", (value, expected) => {
    expect(attachmentPreviewMode(value)).toBe(expected);
  });

  it("bounds document decoding and marks the preview as truncated", () => {
    const bytes = new Uint8Array(MAX_DOCUMENT_PREVIEW_BYTES + 1).fill(97);
    const result = decodePreviewDocument({
      bodyBase64: fromByteArray(bytes),
      contentType: "text/plain",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.source).toHaveLength(MAX_DOCUMENT_PREVIEW_BYTES);
      expect(result.document.truncated).toBe(true);
    }
  });

  it("rejects malformed base64 instead of crashing the preview route", () => {
    expect(decodePreviewDocument({ bodyBase64: "***", contentType: "text/plain" })).toEqual({
      message: "This attachment contains invalid document data.",
      ok: false,
    });
  });

  it("isolates untrusted HTML from scripts, requests, forms, and navigation", () => {
    const result = isolatedPreviewHtml("<html><head></head><body>Report</body></html>");

    expect(result).toContain("default-src 'none'");
    expect(result).toContain("connect-src 'none'");
    expect(result).toContain("form-action 'none'");
    expect(result.indexOf("Content-Security-Policy")).toBeLessThan(result.indexOf("</head>"));
  });
});

describe("V2 attachment preview navigation", () => {
  it("carries an already-authoritative attachment into the route without requerying resources", () => {
    const selections = new AttachmentPreviewSelections();
    const owner = qualifiedThread(savedServerId("server-1"), threadId("thread-1"));
    const first = attachment("first.txt", "text/plain");
    const selected = attachment("selected.txt", "text/plain");

    selections.present(owner, [first, selected], selected);

    expect(selections.selection(owner, selected.id)).toEqual({
      attachments: [first, selected],
      selectedId: selected.id,
    });
    expect(
      selections.selection(
        qualifiedThread(savedServerId("server-2"), threadId("thread-1")),
        selected.id,
      ),
    ).toBeNull();
  });
});

describe("V2 attachment rendering capabilities", () => {
  it("invalidates image resolution across servers and changed attachment sources", () => {
    const image = attachment("photo.png", "image/png");
    const create = (server: string, attachments: V2Attachment[]) =>
      createAttachmentRenderingCapabilities({
        attachments,
        navigate: vi.fn(),
        openWorkspaceFile: vi.fn(),
        owner: qualifiedThread(savedServerId(server), threadId("thread-1")),
        preparePreview: vi.fn(),
        preview: () => readyPreviewResource("file:///unused"),
      });

    const original = create("server-1", [image]).imageSourceRevision;
    expect(create("server-2", [image]).imageSourceRevision).not.toBe(original);
    expect(
      create("server-1", [{ ...image, downloadUrl: "/v2/files/preview?path=updated.png" }])
        .imageSourceRevision,
    ).not.toBe(original);
  });

  it("maps exact private references without guessing ambiguous basenames", () => {
    const first = attachment("one/photo.png", "image/png");
    const second = attachment("two/photo.png", "image/png");

    expect(attachmentForReference([first], "./one/photo.png")).toBe(first);
    expect(attachmentForReference([first, second], "photo.png")).toBeNull();
    expect(attachmentForReference([first], first.downloadUrl ?? "")).toBe(first);
  });

  it("routes private documents and galleries through the qualified attachment route", () => {
    const navigate = vi.fn();
    const preparePreview = vi.fn();
    const privateImage = attachment("images/photo.png", "image/png");
    const capabilities = createAttachmentRenderingCapabilities({
      attachments: [privateImage],
      navigate,
      openWorkspaceFile: vi.fn(),
      owner: qualifiedThread(savedServerId("server-1"), threadId("thread-1")),
      preparePreview,
      preview: () => readyPreviewResource("file:///unused"),
    });

    expect(capabilities.openLocalDocument("./images/photo.png")).toBe(true);
    expect(
      capabilities.openImagePreview(
        [renderingImage("image-1", "./images/photo.png", "file:///photo.png")],
        "image-1",
      ),
    ).toBe(true);
    expect(capabilities.openImagePreview([], "missing")).toBe(false);
    expect(preparePreview).toHaveBeenCalledTimes(2);
    expect(preparePreview).toHaveBeenLastCalledWith([privateImage], privateImage);
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith({
      params: { attachmentId: privateImage.id, savedServerId: "server-1", threadId: "thread-1" },
      pathname: "/servers/[savedServerId]/threads/[threadId]/attachments/[attachmentId]",
    });
  });

  it("resolves remote private images through the authenticated preview resource", async () => {
    const privateImage = attachment("photo.png", "image/png");
    const preview = vi.fn(() => readyPreviewResource("http://127.0.0.1:4123/v2/media/id"));
    const capabilities = createAttachmentRenderingCapabilities({
      attachments: [privateImage],
      navigate: vi.fn(),
      openWorkspaceFile: vi.fn(),
      owner: qualifiedThread(savedServerId("server-1"), threadId("thread-1")),
      preparePreview: vi.fn(),
      preview,
    });

    await expect(capabilities.resolvePrivateImageSource("photo.png")).resolves.toEqual({
      headers: { Authorization: "Bearer private" },
      uri: "http://127.0.0.1:4123/v2/media/id",
    });
    expect(preview).toHaveBeenCalledExactlyOnceWith(
      savedServerId("server-1"),
      privateImage.downloadUrl,
      "image",
    );
  });

  it("materializes an image before handing it to the annotation capability", async () => {
    const annotate = vi.fn(async () => undefined);
    const materialize = vi.fn(async () => ({
      contentType: "image/png",
      name: "photo.png",
      uri: "file:///materialized.png",
    }));
    const capabilities = createAttachmentRenderingCapabilities({
      annotate,
      attachments: [attachment("photo.png", "image/png")],
      navigate: vi.fn(),
      openWorkspaceFile: vi.fn(),
      owner: qualifiedThread(savedServerId("server-1"), threadId("thread-1")),
      preparePreview: vi.fn(),
      preview: () => ({ ...readyPreviewResource("file:///stream.png"), materialize }),
    });

    await capabilities.annotateImage?.(renderingImage("photo.png", "photo.png", "https://x/p"));

    expect(materialize).toHaveBeenCalledExactlyOnceWith("photo.png", "image/png");
    expect(annotate).toHaveBeenCalledExactlyOnceWith({
      attachmentId: "photo.png",
      name: "photo.png",
      source: { contentType: "image/png", name: "photo.png", uri: "file:///materialized.png" },
    });
  });

  it("opens a normalized cwd-relative Markdown file through the workspace capability", () => {
    const openWorkspaceFile = vi.fn();
    const capabilities = createAttachmentRenderingCapabilities({
      attachments: [],
      navigate: vi.fn(),
      openWorkspaceFile,
      owner: qualifiedThread(savedServerId("server-1"), threadId("thread-1")),
      preparePreview: vi.fn(),
      preview: () => readyPreviewResource("file:///unused"),
    });

    expect(capabilities.openLocalDocument("docs/../README%20copy.md#install")).toBe(true);
    expect(openWorkspaceFile).toHaveBeenCalledExactlyOnceWith("README copy.md");
    expect(capabilities.openLocalDocument("../../private.txt")).toBe(false);
  });
});

describe("V2 workspace file references", () => {
  it("normalizes relative and absolute host paths while rejecting relative escapes", () => {
    expect(workspaceFileReference("docs/./guide.md#section")).toBe("docs/guide.md");
    expect(workspaceFileReference("docs/%E2%9C%93.md")).toBe("docs/✓.md");
    expect(workspaceFileReference("../private.md")).toBeNull();
    expect(workspaceFileReference("/tmp/../etc/hosts")).toBe("/etc/hosts");
    expect(workspaceFileReference("%00private.md")).toBeNull();
  });
});

function attachment(name: string, mediaType: string): V2Attachment {
  return {
    downloadUrl: `/v2/files/preview?path=${name}`,
    id: name,
    mediaType,
    name,
    sizeBytes: "1",
  };
}

function previewTransport(overrides: Partial<PreviewTransport>): PreviewTransport {
  return {
    exportFile: overrides.exportFile ?? vi.fn<PreviewTransport["exportFile"]>(),
    materialize: overrides.materialize ?? vi.fn<PreviewTransport["materialize"]>(),
    read: overrides.read ?? vi.fn<PreviewTransport["read"]>(),
    save: overrides.save ?? vi.fn<PreviewTransport["save"]>(),
    stream:
      overrides.stream ??
      vi.fn<PreviewTransport["stream"]>().mockResolvedValue({ headers: null, uri: "file:///a" }),
  };
}

function readyPreviewResource(uri: string) {
  return {
    materialize: async (name: string, contentType: string) => ({ contentType, name, uri }),
    snapshot: () => ({
      status: "ready" as const,
      value: {
        document: null,
        stream: { headers: { Authorization: "Bearer private" }, uri },
      },
    }),
    subscribe: () => () => undefined,
  };
}

function renderingImage(id: string, reference: string, uri: string) {
  return { alt: id, id, order: 0, reference, source: { uri } };
}

async function settled(resource: PreviewResource): Promise<void> {
  for (let attempt = 0; attempt < 10 && resource.snapshot().status === "loading"; attempt += 1) {
    await Promise.resolve();
  }
  expect(resource.snapshot().status).not.toBe("loading");
}
