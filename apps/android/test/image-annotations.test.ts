import { describe, expect, it } from "vitest";

import { clampNormalizedCoordinate, serializeImageReviewAttachment } from "../src/rendering/image-annotations";

describe("image annotations", () => {
  it("formats stable top-left normalized coordinates for Codex", () => {
    expect(serializeImageReviewAttachment([{
      label: "Photo 1.jpg",
      reference: "/workspace/Photo 1.jpg",
      annotations: [
        { id: "one", x: 0.1251, y: 0.8749, text: "Reduce this spacing" },
        { id: "two", x: 1.5, y: -0.3, text: "Keep this inside the image" },
      ],
    }])).toBe([
      "---",
      "kind: codewide-image-review",
      "version: 1",
      "images: 1",
      "comments: 2",
      "---",
      "",
      "# Image review comments",
      "",
      "Coordinates are percentages of the original image, measured from the top-left corner.",
      "",
      "## Image 1: `Photo 1.jpg`",
      "",
      "Reference: `/workspace/Photo 1.jpg`",
      "",
      "1. **(12.5%, 87.5%)** — Reduce this spacing",
      "2. **(100.0%, 0.0%)** — Keep this inside the image",
      "",
    ].join("\n"));
  });

  it("drops empty image groups and clamps coordinates", () => {
    expect(serializeImageReviewAttachment([{ label: "unused", reference: null, annotations: [] }])).toBe("");
    expect(clampNormalizedCoordinate(-1)).toBe(0);
    expect(clampNormalizedCoordinate(2)).toBe(1);
  });
});
