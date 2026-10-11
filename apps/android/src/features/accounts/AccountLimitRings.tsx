import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { colors } from "../../theme";
import { SETTINGS_ROW_LEADING_SIZE } from "../../ui/settingsRowLayout";
import { accountLimitProgressColor } from "./accountResetPresentation";

const DIAMETER_TO_RADIUS = 2;
const STROKE_WIDTH = 2;
const PERCENT_MAX = 100;
/** One line of body text: the rings beside a figure in a list row. */
const INLINE_SIZE = 20;
const LEADING_INNER_RADIUS = 10;
const INLINE_INNER_RADIUS = 5;

interface RingGeometry {
  readonly center: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly size: number;
}

const ringGeometry = (size: number, innerRadius: number): RingGeometry => ({
  center: size / DIAMETER_TO_RADIUS,
  innerRadius,
  outerRadius: (size - STROKE_WIDTH) / DIAMETER_TO_RADIUS,
  size,
});

/** `leading`: the leading slot of a settings row; `inline`: next to text in a compact row. */
const GEOMETRY = {
  inline: ringGeometry(INLINE_SIZE, INLINE_INNER_RADIUS),
  leading: ringGeometry(SETTINGS_ROW_LEADING_SIZE, LEADING_INNER_RADIUS),
} as const satisfies Record<string, RingGeometry>;
type FiveHourLimit =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly remainingPercent: number | null };

interface AccountLimitRingsProps {
  readonly fiveHour: FiveHourLimit;
  /** Defaults to `leading`. */
  readonly size?: keyof typeof GEOMETRY;
  readonly testID: string;
  readonly weeklyRemainingPercent: number | null;
}

/** Account-specific weekly/five-hour usage and selection status in one compact mark. */
export function AccountLimitRings(props: AccountLimitRingsProps): React.JSX.Element {
  const geometry = GEOMETRY[props.size ?? "leading"];
  const weekly = clampPercent(props.weeklyRemainingPercent);
  const fiveHour =
    props.fiveHour.kind === "present" ? clampPercent(props.fiveHour.remainingPercent) : null;
  return (
    <View
      accessibilityLabel={limitRingsAccessibilityLabel(
        weekly,
        props.fiveHour.kind === "present" ? { kind: "present", percent: fiveHour } : props.fiveHour,
      )}
      accessibilityRole="image"
      style={[styles.rings, { height: geometry.size, width: geometry.size }]}
      testID={props.testID}
    >
      <Svg
        height={geometry.size}
        viewBox={`0 0 ${String(geometry.size)} ${String(geometry.size)}`}
        width={geometry.size}
      >
        <LimitRing
          center={geometry.center}
          color={accountLimitProgressColor(weekly)}
          percent={weekly}
          radius={geometry.outerRadius}
          testID={`${props.testID}-weekly`}
        />
        {props.fiveHour.kind === "present" && (
          <LimitRing
            center={geometry.center}
            color={accountLimitProgressColor(fiveHour)}
            percent={fiveHour}
            radius={geometry.innerRadius}
            testID={`${props.testID}-five-hour`}
          />
        )}
      </Svg>
    </View>
  );
}

function LimitRing({
  center,
  color,
  percent,
  radius,
  testID,
}: {
  readonly center: number;
  readonly color: string;
  readonly percent: number | null;
  readonly radius: number;
  readonly testID: string;
}): React.JSX.Element {
  const circumference = DIAMETER_TO_RADIUS * Math.PI * radius;
  return (
    <>
      <Circle
        cx={center}
        cy={center}
        fill="none"
        r={radius}
        stroke={colors.surfaceContainerHighest}
        strokeWidth={STROKE_WIDTH}
        testID={testID}
      />
      {percent !== null && (
        <Circle
          cx={center}
          cy={center}
          fill="none"
          r={radius}
          stroke={color}
          strokeDasharray={`${String(circumference)} ${String(circumference)}`}
          strokeDashoffset={circumference * (1 - percent / PERCENT_MAX)}
          strokeLinecap="round"
          strokeWidth={STROKE_WIDTH}
          testID={`${testID}-progress`}
          transform={`rotate(-90 ${String(center)} ${String(center)})`}
        />
      )}
    </>
  );
}

function clampPercent(percent: number | null): number | null {
  return percent === null ? null : Math.max(0, Math.min(PERCENT_MAX, percent));
}

function limitRingsAccessibilityLabel(
  weekly: number | null,
  fiveHour:
    | { readonly kind: "absent" }
    | { readonly kind: "present"; readonly percent: number | null },
): string {
  const weeklyLabel = weekly === null ? "Weekly limit pending" : `Weekly ${String(weekly)}% left`;
  const fiveHourLabel =
    fiveHour.kind === "absent"
      ? "No five-hour limit"
      : fiveHour.percent === null
        ? "Five-hour usage pending"
        : `Five-hour ${String(fiveHour.percent)}% left`;
  return `${weeklyLabel}. ${fiveHourLabel}`;
}

const styles = StyleSheet.create({
  rings: {
    alignItems: "center",
    justifyContent: "center",
  },
});
