/** V1 CalmSpinner owner, extracted without changing interaction or resource lifetime. */
import { ActivityIndicator, View } from "react-native";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";

export function CalmSpinner({ color, size }: { color: string; durationMs: number; size: number }) {
  const reducedMotion = useReducedMotionPreference();
  if (reducedMotion) {
    return (
      <View
        style={{
          borderColor: color,
          borderRadius: size / 2,
          borderTopColor: "transparent",
          borderWidth: 1.25,
          height: size,
          opacity: 0.72,
          width: size,
        }}
        testID="calm-running-spinner"
      />
    );
  }
  return (
    <ActivityIndicator
      animating
      color={color}
      size={size}
      style={{
        height: size,
        opacity: 0.72,
        width: size,
      }}
      testID="calm-running-spinner"
    />
  );
}
