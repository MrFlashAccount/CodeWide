const DESKTOP_BREAKPOINT = 840;

export type WindowLayoutSnapshot = Readonly<{
  desktop: boolean;
  fontScale: number;
  height: number;
  measurementRevision: string;
  scale: number;
  width: number;
}>;

export function windowLayoutSnapshot(
  window: Readonly<{ fontScale?: number; height: number; scale?: number; width: number }>,
): WindowLayoutSnapshot {
  const scale = finitePositiveOr(window.scale, 1);
  const fontScale = finitePositiveOr(window.fontScale, scale);
  return {
    desktop: window.width >= DESKTOP_BREAKPOINT && window.height >= 480,
    fontScale,
    height: window.height,
    measurementRevision: `${String(scale)}:${String(fontScale)}`,
    scale,
    width: window.width,
  };
}

function finitePositiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}
