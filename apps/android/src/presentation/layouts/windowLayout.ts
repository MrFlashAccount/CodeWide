const DESKTOP_BREAKPOINT = 840;

interface WindowSize {
  height: number;
  width: number;
}

export function isDesktopWindow(window: WindowSize): boolean {
  return window.width >= DESKTOP_BREAKPOINT && window.height >= 480;
}

export function desktopThreadSidebarWidth(viewportWidth: number): number {
  return Math.max(280, Math.min(480, Math.floor(viewportWidth * 0.32)));
}
