export type ImagePreviewGestureAxis = 0 | 1 | 2 | 3;

export interface ImagePreviewSize {
  height: number;
  width: number;
}

export interface ImagePreviewTranslation {
  x: number;
  y: number;
}

export const IMAGE_PREVIEW_MAX_SCALE = 5;
export const IMAGE_PREVIEW_DOUBLE_TAP_SCALE = 2.5;

export function containImageSize(
  image: ImagePreviewSize,
  viewport: ImagePreviewSize,
): ImagePreviewSize {
  "worklet";
  const ratio = Math.min(
    viewport.width / Math.max(1, image.width),
    viewport.height / Math.max(1, image.height),
  );
  return {
    height: Math.max(1, image.height * ratio),
    width: Math.max(1, image.width * ratio),
  };
}

export function resolveImagePreviewAxis(
  translationX: number,
  translationY: number,
): ImagePreviewGestureAxis {
  "worklet";
  const horizontalDistance = Math.abs(translationX);
  const verticalDistance = Math.abs(translationY);
  if (Math.max(horizontalDistance, verticalDistance) < 8) return 0;
  return horizontalDistance > verticalDistance ? 1 : 2;
}

export function shouldNavigateImage(
  translationX: number,
  velocityX: number,
  viewportWidth: number,
): boolean {
  "worklet";
  return Math.abs(translationX) > viewportWidth * 0.16 || Math.abs(velocityX) > 720;
}

export function shouldDismissImage(
  translationY: number,
  velocityY: number,
  viewportHeight: number,
): boolean {
  "worklet";
  return Math.abs(translationY) > viewportHeight * 0.14 || Math.abs(velocityY) > 820;
}

export function clampImageTranslation(
  translation: ImagePreviewTranslation,
  fitted: ImagePreviewSize,
  viewport: ImagePreviewSize,
  scale: number,
): ImagePreviewTranslation {
  "worklet";
  const maxX = Math.max(0, (fitted.width * scale - viewport.width) / 2);
  const maxY = Math.max(0, (fitted.height * scale - viewport.height) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, translation.x)),
    y: Math.max(-maxY, Math.min(maxY, translation.y)),
  };
}

export function doubleTapImageTranslation(
  tap: ImagePreviewTranslation,
  fitted: ImagePreviewSize,
  viewport: ImagePreviewSize,
): ImagePreviewTranslation {
  "worklet";
  const zoom = IMAGE_PREVIEW_DOUBLE_TAP_SCALE - 1;
  return clampImageTranslation(
    {
      x: (viewport.width / 2 - tap.x) * zoom,
      y: (viewport.height / 2 - tap.y) * zoom,
    },
    fitted,
    viewport,
    IMAGE_PREVIEW_DOUBLE_TAP_SCALE,
  );
}
