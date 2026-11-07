import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

/** Web reveals content directly; native-only readiness animation stays on Android. */
export function NativeRevealSurface({
  children,
  style,
}: {
  animate?: boolean;
  children: ReactNode;
  delayMs?: number;
  ready?: boolean;
  revealKey: string;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <View pointerEvents="box-none" style={style}>
      {children}
    </View>
  );
}
