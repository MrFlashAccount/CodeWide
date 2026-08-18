const DESKTOP_BREAKPOINT = 840;

export type WindowLayoutSnapshot = Readonly<{
  width: number;
  height: number;
  scale: number;
  fontScale: number;
  measurementRevision: string;
  desktop: boolean;
}>;

export function windowLayoutSnapshot(window: Readonly<{ width: number; height: number; scale?: number; fontScale?: number }>): WindowLayoutSnapshot {
  const scale = finitePositiveOr(window.scale, 1);
  const fontScale = finitePositiveOr(window.fontScale, scale);
  return {
    width: window.width,
    height: window.height,
    scale,
    fontScale,
    measurementRevision: `${scale}:${fontScale}`,
    desktop: window.width >= DESKTOP_BREAKPOINT && window.height >= 480,
  };
}

function finitePositiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}
