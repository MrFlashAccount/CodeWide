import Svg, { Polyline } from "react-native-svg";

import type { PerformanceMetricPoint } from "../../features/diagnostics/diagnosticsTypes";
import { colors, spacing } from "../../theme";
import { ProductText } from "../text/ProductText";

interface PerformanceSparklineProps {
  points: readonly PerformanceMetricPoint[];
}

const CHART_WIDTH = 300;
const CHART_HEIGHT = 62;
const CPU_CEILING = 100;
const FRAME_CEILING = 33;

export function PerformanceSparkline(props: PerformanceSparklineProps): React.JSX.Element {
  if (props.points.length < 2) return <ProductText tone="dim">Waiting for history…</ProductText>;
  const cpuPoints = linePoints(
    props.points.map(cpuPercent),
    CHART_WIDTH,
    CHART_HEIGHT,
    CPU_CEILING,
  );
  const frameCeiling = Math.max(FRAME_CEILING, ...props.points.map(p95FrameMs));
  const framePoints = linePoints(
    props.points.map(p95FrameMs),
    CHART_WIDTH,
    CHART_HEIGHT,
    frameCeiling,
  );
  return (
    <Svg
      height={CHART_HEIGHT}
      preserveAspectRatio="none"
      viewBox={`0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`}
      width="100%"
    >
      <Polyline
        fill="none"
        points={cpuPoints}
        stroke={colors.green}
        strokeWidth={spacing.optical}
        vectorEffect="non-scaling-stroke"
      />
      <Polyline
        fill="none"
        points={framePoints}
        stroke={colors.amber}
        strokeWidth={spacing.optical}
        vectorEffect="non-scaling-stroke"
      />
    </Svg>
  );
}

function cpuPercent(point: PerformanceMetricPoint): number {
  return point.cpuPercent;
}

function p95FrameMs(point: PerformanceMetricPoint): number {
  return point.p95FrameMs;
}

function linePoints(
  values: readonly number[],
  width: number,
  height: number,
  ceiling: number,
): string {
  const span = Math.max(1, ceiling);
  const xStep = values.length === 1 ? 0 : width / (values.length - 1);
  return values
    .map((value, index) => {
      const normalized = Math.max(0, Math.min(1, value / span));
      return `${(index * xStep).toFixed(2)},${(height - normalized * height).toFixed(2)}`;
    })
    .join(" ");
}
