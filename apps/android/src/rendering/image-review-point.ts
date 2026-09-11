interface ImageReviewGeometry {
  readonly width: number;
  readonly height: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly scale: number;
  readonly translateX: number;
  readonly translateY: number;
}

interface ImageReviewTap {
  readonly x: number;
  readonly y: number;
}

/** Inverts the centered image transform; letterbox taps are not image points. */
export function imageReviewPoint(tap: ImageReviewTap, geometry: ImageReviewGeometry): ImageReviewTap | null {
  "worklet";
  const x = (tap.x - geometry.viewportWidth / 2 - geometry.translateX) / (geometry.width * geometry.scale) + 0.5;
  const y = (tap.y - geometry.viewportHeight / 2 - geometry.translateY) / (geometry.height * geometry.scale) + 0.5;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}
