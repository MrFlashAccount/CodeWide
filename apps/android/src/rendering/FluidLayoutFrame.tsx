import { createContext, useContext } from "react";
import { Platform, requireNativeComponent, UIManager, View, type ViewProps } from "react-native";
import { useReducedMotionPreference } from "./reduced-motion-store";

/** Only the visible, idle live tail may animate layout; history keeps its scroll anchor. */
export const TimelineMotionContext = createContext(false);

interface FluidLayoutProps extends ViewProps {
  readonly animate: boolean;
}

const NativeFrame =
  Platform.OS === "android" && UIManager.getViewManagerConfig("CodeWideFluidLayout") != null
    ? requireNativeComponent<FluidLayoutProps>("CodeWideFluidLayout")
    : null;

/** Drawing-only translation and clipping: Yoga and the list retain ownership of geometry. */
export function FluidLayoutFrame({ animate, ...props }: FluidLayoutProps) {
  const allowed = useContext(TimelineMotionContext);
  const reducedMotion = useReducedMotionPreference();
  return NativeFrame === null ? (
    <View {...props} />
  ) : (
    <NativeFrame {...props} animate={animate && allowed && !reducedMotion} />
  );
}
