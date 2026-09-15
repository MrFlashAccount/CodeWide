import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors } from "../../theme";
import { AnimatedNumber, integerNumberFormat } from "../../ui/AnimatedNumber";
import { styles } from "./UsagePopover.styles";

/** Displays context usage geometry and labels calculated by the popover owner. */
export function renderContextRingView({
  progress,
  size,
  radius,
  strokeWidth,
  circumference,
  showValue,
}: {
  progress: ReturnType<typeof Math.max>;
  size: number;
  radius: number;
  strokeWidth: ReturnType<typeof Math.max>;
  circumference: number;
  showValue: boolean;
}) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${Math.round(progress)}% context used`}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.surfaceContainerHighest}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={progress >= 85 ? colors.amber : colors.accent}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - progress / 100)}
          fill="none"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {showValue && (
        <View pointerEvents="none" style={styles.contextRingLabel}>
          <AnimatedNumber
            value={Math.round(progress)}
            format={integerNumberFormat}
            suffix="%"
            style={[
              styles.contextRingLabelText,
              { fontSize: size * 0.22, lineHeight: size * 0.26 },
            ]}
            containerStyle={styles.contextRingNumber}
          />
        </View>
      )}
    </View>
  );
}
