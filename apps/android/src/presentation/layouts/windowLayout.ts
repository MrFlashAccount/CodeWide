const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_VIEWPORT_FRACTION = 0.34;

/** Bounds the catalog width while retaining space for the adjacent conversation. */
export function desktopThreadSidebarWidth(viewportWidth: number): number {
  return Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, Math.floor(viewportWidth * SIDEBAR_VIEWPORT_FRACTION)),
  );
}
