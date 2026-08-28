import { describe, expect, it } from "vitest";

import {
  annotatedImageName,
  createQuickdrawImageSnapshot,
  imageDataUrl,
} from "../src/data/quickdraw-image";

describe("QuickDraw image annotations", () => {
  it("creates a full-resolution locked background image", () => {
    const snapshot = createQuickdrawImageSnapshot("data:image/png;base64,iVBORw==", 1600, 900);

    expect(snapshot).toEqual({
      document: {
        store: {
          "asset:codewide-background": {
            id: "asset:codewide-background",
            typeName: "asset",
            src: "data:image/png;base64,iVBORw==",
            w: 1600,
            h: 900,
          },
          "shape:codewide-background": {
            id: "shape:codewide-background",
            typeName: "shape",
            type: "image",
            x: 0,
            y: 0,
            rot: 0,
            z: -1,
            props: {
              assetId: "asset:codewide-background",
              locked: true,
              w: 1600,
              h: 900,
            },
          },
        },
      },
    });
  });

  it("detects PNG bytes instead of trusting a misleading filename", () => {
    expect(imageDataUrl(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), null, "image.jpg"))
      .toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("creates a bounded filesystem-safe attachment name", () => {
    expect(annotatedImageName("Main screen mockup.png", new Date("2026-08-27T10:11:12.345Z")))
      .toBe("annotated-Main-screen-mockup-2026-08-27T10-11-12-345Z.png");
  });
});
