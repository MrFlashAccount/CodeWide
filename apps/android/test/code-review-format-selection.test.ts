import { describe, expect, it, vi } from "vitest";

vi.mock("../src/rendering/DocumentPreviewHost", () => ({
  loadDocumentPreview: vi.fn(async () => ({ source: "target/\n", truncated: false })),
}));
vi.mock("../src/features/review/resources/loadReviewImage", () => ({
  loadReviewImage: vi.fn(async () => "data:image/png;base64,cHJldmlldw=="),
}));

import { loadDocumentPreview } from "../src/rendering/DocumentPreviewHost";
import { loadReviewImage } from "../src/features/review/resources/loadReviewImage";
import { loadCodeReviewResource } from "../src/features/review/resources/reviewResource";
import { UnsupportedPrivateTextFormatError } from "../src/data/private-transfer";

async function review(
  path: string,
  scope: "lastTurn" | "session" = "session",
  diffSource?: string,
  availability: "available" | "unavailable" = "available",
) {
  return loadCodeReviewResource(
    {
      additions: 1,
      availability,
      deletions: 0,
      itemId: path,
      kind: "add",
      path,
      turnId: "turn",
    },
    scope,
    async () => {
      throw new Error("Unexpected transfer access");
    },
    diffSource === undefined
      ? undefined
      : async () => ({
          changeScope: scope,
          patches: [],
          path,
          source: diffSource,
          threadId: "thread",
          truncated: false,
        }),
    new AbortController().signal,
    undefined,
    vi.fn(),
    undefined,
  );
}

describe("Changes file presentation", () => {
  it("reads a known extensionless text file as code", async () => {
    vi.mocked(loadDocumentPreview).mockClear();
    const result = await review("/repo/.gitignore");
    expect(result.document.source).toBe("target/\n");
    expect(result.document.displayState).toBeUndefined();
    expect(loadDocumentPreview).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "text", path: "/repo/.gitignore" }),
      expect.any(AbortSignal),
    );
  });

  it("materializes an image for the review pane", async () => {
    vi.mocked(loadReviewImage).mockClear();
    const result = await review("/repo/chart.png");
    expect(result.document.displayState).toBe("image");
    if (result.document.displayState !== "image") {
      throw new Error("Image preview was not selected");
    }
    expect(result.document.imageDataUrl).toMatch(/^data:image\//u);
    expect(loadReviewImage).toHaveBeenCalledWith(
      { kind: "path", path: "/repo/chart.png" },
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it("shows unsupported format without requesting binary bytes as text", async () => {
    vi.mocked(loadDocumentPreview).mockClear();
    vi.mocked(loadReviewImage).mockClear();
    const result = await review("/repo/archive.zip");
    expect(result.document.displayState).toBe("unsupported");
    expect(loadDocumentPreview).not.toHaveBeenCalled();
    expect(loadReviewImage).not.toHaveBeenCalled();
  });

  it("keeps an unavailable unknown format out of the code editor", async () => {
    vi.mocked(loadDocumentPreview).mockClear();
    const result = await review("/repo/archive.zip", "session", undefined, "unavailable");
    expect(result.document.displayState).toBe("unsupported");
    expect(loadDocumentPreview).not.toHaveBeenCalled();
  });

  it("shows unsupported format when a known text suffix contains binary bytes", async () => {
    vi.mocked(loadDocumentPreview).mockRejectedValueOnce(new UnsupportedPrivateTextFormatError());
    const result = await review("/repo/binary.txt", "session", "stale diff source");
    expect(result.document.displayState).toBe("unsupported");
  });

  it("keeps binary data out of recorded Turn changes too", async () => {
    vi.mocked(loadDocumentPreview).mockRejectedValueOnce(new UnsupportedPrivateTextFormatError());
    const result = await review("/repo/binary.txt", "lastTurn");
    expect(result.document.displayState).toBe("unsupported");
  });
});
