import { describe, expect, it } from "vitest";

import { recordDecodedImage, wasImageDecoded } from "../src/rendering/imageDecodeCache";

describe("image decode lifetime", () => {
  it("survives a renderer remount for the same materialized URI", () => {
    const uri = `file:///preview/${crypto.randomUUID()}.webp`;

    expect(wasImageDecoded(uri)).toBe(false);
    recordDecodedImage(uri);
    expect(wasImageDecoded(uri)).toBe(true);
  });
});
