import { describe, expect, it } from "vitest";
import { imageReviewPoint } from "../src/rendering/image-review-point";

describe("image review coordinates", () => {
  const geometry = { width: 200, height: 100, viewportWidth: 300, viewportHeight: 300, scale: 1, translateX: 0, translateY: 0 };
  it("uses image coordinates, not the letterboxed viewport", () => {
    expect(imageReviewPoint({ x: 50, y: 100 }, geometry)).toEqual({ x: 0, y: 0 });
    expect(imageReviewPoint({ x: 150, y: 150 }, geometry)).toEqual({ x: 0.5, y: 0.5 });
    expect(imageReviewPoint({ x: 250, y: 200 }, geometry)).toEqual({ x: 1, y: 1 });
    expect(imageReviewPoint({ x: 150, y: 90 }, geometry)).toBeNull();
  });
  it("keeps the same pin attached to the same pixel after zooming and panning", () => {
    const transformed = { ...geometry, scale: 2, translateX: 30, translateY: -10 };
    expect(imageReviewPoint({ x: 80, y: 190 }, transformed)).toEqual({ x: 0.25, y: 0.75 });
    expect(imageReviewPoint({ x: 100, y: 175 }, geometry)).toEqual({ x: 0.25, y: 0.75 });
  });
});
