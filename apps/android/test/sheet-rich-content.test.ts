import { describe, expect, it } from "vitest";

import { documentPreviewSurface } from "../src/rendering/document-preview";

describe("document preview surfaces", () => {
  it("keeps text-backed documents out of the bottom sheet", () => {
    expect(documentPreviewSurface("markdown")).toBe("fullscreen");
    expect(documentPreviewSurface("html")).toBe("fullscreen");
    expect(documentPreviewSurface("text")).toBe("fullscreen");
  });
});
