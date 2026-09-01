import {
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from "react-native";
import Svg, { Circle } from "react-native-svg";

import { useEvent } from "../../react/useEvent";
import { colors, radii, touchTarget } from "../../theme";
import { ProductText } from "../text/ProductText";

interface ContextRingActionViewProps {
  onPress?(): void;
  percent: number;
}

interface ContextRingViewProps {
  percent: number;
  showValue?: boolean;
  size?: number;
}

export function ContextRingActionView(props: ContextRingActionViewProps): React.JSX.Element {
  const { onPress, percent } = props;
  const activate = useEvent(() => onPress?.());
  return (
    <Pressable
      accessibilityLabel="Context usage and account limits"
      accessibilityRole="button"
      onPress={activate}
      style={contextRingActionStyle}
    >
      <ContextRingView percent={percent} />
    </Pressable>
  );
}

export function ContextRingView(props: ContextRingViewProps): React.JSX.Element {
  const { percent, showValue = false, size = 22 } = props;
  const strokeWidth = Math.max(2, size * 0.12);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, percent));
  return (
    <View
      accessibilityLabel={`${Math.round(progress)}% context used`}
      accessibilityRole="image"
      style={{ height: size, width: size }}
    >
      <Svg height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
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
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - progress / 100)}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {showValue ? (
        <View pointerEvents="none" style={styles.ringLabel}>
          <ProductText
            style={[styles.ringLabelText, { fontSize: size * 0.22, lineHeight: size * 0.26 }]}
            weight="semibold"
          >
            {Math.round(progress)}%
          </ProductText>
        </View>
      ) : null}
    </View>
  );
}

export function contextRingActionStyle(state: PressableStateCallbackType): StyleProp<ViewStyle> {
  const { pressed } = state;
  return [styles.action, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  pressed: { opacity: 0.68 },
  ringLabel: { alignItems: "center", inset: 0, justifyContent: "center", position: "absolute" },
  ringLabelText: {
    color: colors.text,
    fontWeight: "600",
    includeFontPadding: false,
    textAlign: "center",
    width: "100%",
  },
});
