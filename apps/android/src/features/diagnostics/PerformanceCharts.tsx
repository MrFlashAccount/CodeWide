import { View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { type PerformanceMetricPoint } from "../../native/performance-metrics";
import { colors } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./PerformanceDiagnostics.styles";

export function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.82}
        style={styles.metricValue}
      >
        {value}
      </Text>
      <Text numberOfLines={1} style={styles.metricDetail}>
        {detail}
      </Text>
    </View>
  );
}

export function PerformanceSparkline({ points }: { points: PerformanceMetricPoint[] }) {
  const width = 300;
  const height = 62;
  const cpuPoints = linePoints(
    points.map((point) => point.cpuPercent),
    width,
    height,
    0,
    100,
  );
  const frameCeiling = Math.max(33, ...points.map((point) => point.p95FrameMs));
  const framePoints = linePoints(
    points.map((point) => point.p95FrameMs),
    width,
    height,
    0,
    frameCeiling,
  );
  return (
    <View style={styles.sparkline}>
      {points.length < 2 ? (
        <Text style={styles.chartEmpty}>Waiting for history…</Text>
      ) : (
        <Svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
        >
          <Polyline
            points={cpuPoints}
            fill="none"
            stroke={colors.green}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <Polyline
            points={framePoints}
            fill="none"
            stroke={colors.amber}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </Svg>
      )}
    </View>
  );
}

export function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

function linePoints(
  values: number[],
  width: number,
  height: number,
  floor: number,
  ceiling: number,
): string {
  if (values.length === 0) return "";
  const span = Math.max(1, ceiling - floor);
  const xStep = values.length === 1 ? 0 : width / (values.length - 1);
  return values
    .map((value, index) => {
      const normalized = Math.max(0, Math.min(1, (value - floor) / span));
      return `${(index * xStep).toFixed(2)},${(height - normalized * height).toFixed(2)}`;
    })
    .join(" ");
}
