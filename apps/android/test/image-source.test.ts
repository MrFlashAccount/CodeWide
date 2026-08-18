import { describe, expect, it } from "vitest";

import { inlineImagePayload, privateImageAssetProjection, safeImageUri, userImageSourceProjection } from "../src/rendering/image-source";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";

describe("safe image sources", () => {
  it("accepts remote and inline image URLs", () => {
    expect(safeImageUri("https://example.test/image.png")).toBe("https://example.test/image.png");
    expect(safeImageUri(`data:image/png;base64,${PNG_BASE64}`)).toBe(`data:image/png;base64,${PNG_BASE64}`);
  });

  it("wraps raw image-generation base64", () => {
    expect(safeImageUri(PNG_BASE64)).toBe(`data:image/png;base64,${PNG_BASE64}`);
    expect(inlineImagePayload(PNG_BASE64)).toEqual({ base64: PNG_BASE64, extension: "png" });
    expect(inlineImagePayload(`data:image/jpeg;base64,/9j/AAAA`)).toEqual({ base64: "/9j/AAAA", extension: "jpg" });
  });

  it("rejects non-image and active schemes", () => {
    expect(safeImageUri("http://example.test/image.png")).toBeNull();
    expect(safeImageUri("javascript:alert(1)")).toBeNull();
    expect(safeImageUri("data:text/html;base64,PGgxPk5vPC9oMT4=")).toBeNull();
    expect(safeImageUri("not an image")).toBeNull();
  });

  it("accepts projected private image assets", () => {
    const id = "a".repeat(64);
    expect(privateImageAssetProjection({
      version: 1,
      id,
      byteLength: 319_824,
      contentType: "image/jpeg",
    })).toEqual({ id, byteLength: 319_824, contentType: "image/jpeg" });
    expect(userImageSourceProjection({
      type: "image",
      url: "",
      codewideAsset: { version: 1, id, byteLength: 319_824, contentType: "image/jpeg" },
    })).toEqual({
      kind: "content",
      asset: { id, byteLength: 319_824, contentType: "image/jpeg" },
    });
  });

  it("rejects malformed or non-image private assets", () => {
    expect(privateImageAssetProjection({ version: 1, id: "nope", byteLength: 12, contentType: "image/png" })).toBeNull();
    expect(privateImageAssetProjection({ version: 1, id: "b".repeat(64), byteLength: 0, contentType: "image/png" })).toBeNull();
    expect(privateImageAssetProjection({ version: 1, id: "c".repeat(64), byteLength: 12, contentType: "text/plain" })).toBeNull();
  });
});
