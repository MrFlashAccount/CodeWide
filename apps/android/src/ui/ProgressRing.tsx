import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { colors } from "../theme";

/** Share of the ring drawn while the total is still unknown. */
const UNKNOWN_PROGRESS_ARC = 0.25;
const HALF = 2;
const FULL_TURN_START_DEGREES = -90;

/** A determinate ring for `progress` 0..1; `null` draws a short arc while the total is unknown. */
export function ProgressRing({
  color = colors.accent,
  progress,
  size,
  strokeWidth,
  testID,
}: {
  readonly color?: string;
  readonly progress: number | null;
  readonly size: number;
  readonly strokeWidth: number;
  readonly testID?: string;
}): React.JSX.Element {
  const radius = (size - strokeWidth) / HALF;
  const circumference = HALF * Math.PI * radius;
  const share = progress === null ? UNKNOWN_PROGRESS_ARC : Math.min(1, Math.max(0, progress));
  const center = size / HALF;
  return (
    <View pointerEvents="none" style={{ height: size, width: size }} testID={testID}>
      <Svg height={size} viewBox={`0 0 ${String(size)} ${String(size)}`} width={size}>
        <Circle
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          stroke={colors.surfaceContainerHighest}
          strokeWidth={strokeWidth}
        />
        <Circle
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          stroke={color}
          strokeDasharray={`${String(circumference)} ${String(circumference)}`}
          strokeDashoffset={circumference * (1 - share)}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          transform={`rotate(${String(FULL_TURN_START_DEGREES)} ${String(center)} ${String(center)})`}
        />
      </Svg>
    </View>
  );
}
