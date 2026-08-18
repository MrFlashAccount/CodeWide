import { describe, expect, it } from "vitest";

import { windowLayoutSnapshot } from "../src/native/window-layout";

describe("window layout projection", () => {
  it("preserves live dimensions while the desktop breakpoint stays unchanged", () => {
    expect(windowLayoutSnapshot({ width: 1_000, height: 700 })).toEqual({
      width: 1_000,
      height: 700,
      scale: 1,
      fontScale: 1,
      measurementRevision: "1:1",
      desktop: true,
    });
    expect(windowLayoutSnapshot({ width: 1_400, height: 700 }).desktop).toBe(true);
  });

  it("switches layout modes after rotation or compact window resize", () => {
    expect(windowLayoutSnapshot({ width: 1_200, height: 800 }).desktop).toBe(true);
    expect(windowLayoutSnapshot({ width: 800, height: 1_200 }).desktop).toBe(false);
    expect(windowLayoutSnapshot({ width: 900, height: 420 }).desktop).toBe(false);
  });

  it("changes measurement revision when Samsung windowed mode changes density without resizing", () => {
    const fullscreen = windowLayoutSnapshot({ width: 1_000, height: 700, scale: 3, fontScale: 3 });
    const windowed = windowLayoutSnapshot({ width: 1_000, height: 700, scale: 2, fontScale: 2.6 });

    expect(windowed.desktop).toBe(fullscreen.desktop);
    expect(windowed.measurementRevision).not.toBe(fullscreen.measurementRevision);
    expect(windowed).toMatchObject({ scale: 2, fontScale: 2.6 });
  });
});
