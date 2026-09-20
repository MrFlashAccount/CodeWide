import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { colors } from "../../theme";
import { accountLimitProgressColor } from "./accountResetPresentation";

const SIZE = 36;
const DIAMETER_TO_RADIUS = 2;
const CENTER = SIZE / DIAMETER_TO_RADIUS;
const OUTER_STROKE_WIDTH = 2;
const INNER_STROKE_WIDTH = 2;
const OUTER_RADIUS = (SIZE - OUTER_STROKE_WIDTH) / DIAMETER_TO_RADIUS;
const INNER_RADIUS = 10;
const PERCENT_MAX = 100;
type FiveHourLimit =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly remainingPercent: number | null };

interface AccountLimitRingsProps {
  readonly fiveHour: FiveHourLimit;
  readonly testID: string;
  readonly weeklyRemainingPercent: number | null;
}

/** Account-specific weekly/five-hour usage and selection status in one compact mark. */
export function AccountLimitRings(props: AccountLimitRingsProps): React.JSX.Element {
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
      style={styles.rings}
      testID={props.testID}
    >
      <Svg height={SIZE} viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`} width={SIZE}>
        <LimitRing
          color={accountLimitProgressColor(weekly)}
          percent={weekly}
          radius={OUTER_RADIUS}
          strokeWidth={OUTER_STROKE_WIDTH}
          testID={`${props.testID}-weekly`}
        />
        {props.fiveHour.kind === "present" && (
          <LimitRing
            color={accountLimitProgressColor(fiveHour)}
            percent={fiveHour}
            radius={INNER_RADIUS}
            strokeWidth={INNER_STROKE_WIDTH}
            testID={`${props.testID}-five-hour`}
          />
        )}
      </Svg>
    </View>
  );
}

function LimitRing({
  color,
  percent,
  radius,
  strokeWidth,
  testID,
}: {
  readonly color: string;
  readonly percent: number | null;
  readonly radius: number;
  readonly strokeWidth: number;
  readonly testID: string;
}): React.JSX.Element {
  const circumference = DIAMETER_TO_RADIUS * Math.PI * radius;
  return (
    <>
      <Circle
        cx={CENTER}
        cy={CENTER}
        fill="none"
        r={radius}
        stroke={colors.surfaceContainerHighest}
        strokeWidth={strokeWidth}
        testID={testID}
      />
      {percent !== null && (
        <Circle
          cx={CENTER}
          cy={CENTER}
          fill="none"
          r={radius}
          stroke={color}
          strokeDasharray={`${String(circumference)} ${String(circumference)}`}
          strokeDashoffset={circumference * (1 - percent / PERCENT_MAX)}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          testID={`${testID}-progress`}
          transform={`rotate(-90 ${String(CENTER)} ${String(CENTER)})`}
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
    height: SIZE,
    justifyContent: "center",
    width: SIZE,
  },
});
