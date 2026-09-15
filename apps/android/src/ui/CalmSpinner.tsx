/** V1 CalmSpinner owner, extracted without changing interaction or resource lifetime. */
import { ActivityIndicator, View } from "react-native";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";

export function CalmSpinner({ size, color }: { size: number; color: string; durationMs: number }) {
  const reducedMotion = useReducedMotionPreference();
  if (reducedMotion) {
    return (
      <View
        testID="calm-running-spinner"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.25,
          borderColor: color,
          borderTopColor: "transparent",
          opacity: 0.72,
        }}
      />
    );
  }
  return (
    <ActivityIndicator
      testID="calm-running-spinner"
      animating
      color={color}
      size={size}
      style={{
        width: size,
        height: size,
        opacity: 0.72,
      }}
    />
  );
}
