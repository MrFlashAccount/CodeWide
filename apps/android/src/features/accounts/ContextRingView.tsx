import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors } from "../../theme";
import { AnimatedNumber, integerNumberFormat } from "../../ui/AnimatedNumber";
import { styles } from "./UsageMenu.styles";

/** Displays context usage geometry and labels calculated by the menu owner. */
export function renderContextRingView({
  circumference,
  progress,
  radius,
  showValue,
  size,
  strokeWidth,
}: {
  circumference: number;
  progress: ReturnType<typeof Math.max>;
  radius: number;
  showValue: boolean;
  size: number;
  strokeWidth: ReturnType<typeof Math.max>;
}) {
  return (
    <View
      accessibilityLabel={`${String(Math.round(progress))}% context used`}
      accessibilityRole="image"
      accessible
      style={{ height: size, width: size }}
    >
      <Svg height={size} viewBox={`0 0 ${String(size)} ${String(size)}`} width={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke={colors.surfaceContainerHighest}
          strokeWidth={strokeWidth}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          stroke={progress >= 85 ? colors.amber : colors.accent}
          strokeDasharray={`${String(circumference)} ${String(circumference)}`}
          strokeDashoffset={circumference * (1 - progress / 100)}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          transform={`rotate(-90 ${String(size / 2)} ${String(size / 2)})`}
        />
      </Svg>
      {showValue && (
        <View pointerEvents="none" style={styles.contextRingLabel}>
          <AnimatedNumber
            containerStyle={styles.contextRingNumber}
            format={integerNumberFormat}
            style={[
              styles.contextRingLabelText,
              { fontSize: size * 0.22, lineHeight: size * 0.26 },
            ]}
            suffix="%"
            value={Math.round(progress)}
          />
        </View>
      )}
    </View>
  );
}
