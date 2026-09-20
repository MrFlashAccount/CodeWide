import { createContext, type ReactNode, useContext } from "react";
import { StyleSheet, View } from "react-native";

import { colors, radii, spacing } from "../theme";
import { RecoverableRenderBoundary } from "../ui/RecoverableRenderBoundary";
import { FluidLayoutFrame } from "./FluidLayoutFrame";

export type BubbleVariant = "agent" | "user";

const InsideBubbleSurfaceContext = createContext(false);

export function useInsideBubbleSurface(): boolean {
  return useContext(InsideBubbleSurfaceContext);
}

/**
 * A purely declarative bubble surface. Yoga owns both axes; this component
 * never measures content or writes computed width/height back into layout.
 */
export function Bubble({
  animateLayout = false,
  children,
  errorContext,
  errorLabel,
  errorResetKey,
  fill = false,
  footer,
  segment = "single",
  testID,
  variant,
}: {
  animateLayout?: boolean;
  children: ReactNode;
  errorContext?: string;
  errorLabel?: string;
  errorResetKey?: string;
  fill?: boolean;
  footer?: ReactNode;
  segment?: "end" | "middle" | "single" | "start";
  testID?: string;
  variant: BubbleVariant;
}) {
  const surfaceStyle = [
    styles.surface,
    variant === "agent" ? styles.agentSurface : styles.userSurface,
    variant === "agent" && segment !== "single" && styles.segmentedAgentSurface,
    variant === "agent" && segment === "start" && styles.segmentedAgentSurfaceStart,
    variant === "agent" && segment === "end" && styles.segmentedAgentSurfaceEnd,
  ];
  return (
    <RecoverableRenderBoundary
      label={errorLabel ?? (variant === "agent" ? "Agent message" : "User message")}
      scope="bubble"
      {...(errorContext === undefined ? {} : { context: errorContext })}
      resetKey={errorResetKey ?? `${variant}:${testID ?? "bubble"}`}
    >
      {variant === "agent" ? (
        <View
          style={[
            styles.agentFrame,
            fill && styles.agentFrameFill,
            footer !== null && footer !== undefined && styles.agentFrameWithFooter,
          ]}
          testID="agent-bubble-frame"
        >
          <FluidLayoutFrame animate={animateLayout} style={surfaceStyle} testID={testID}>
            {children}
          </FluidLayoutFrame>
          {footer !== null && footer !== undefined && (
            <FluidLayoutFrame animate={animateLayout}>{footer}</FluidLayoutFrame>
          )}
        </View>
      ) : (
        <View style={surfaceStyle} testID={testID}>
          {children}
        </View>
      )}
    </RecoverableRenderBoundary>
  );
}

export function BubbleContent({ children }: { children: ReactNode }) {
  return (
    <InsideBubbleSurfaceContext.Provider value>
      <View style={styles.content}>{children}</View>
    </InsideBubbleSurfaceContext.Provider>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: radii.selected,
    minWidth: 0,
  },
  // The body and footer share one intrinsic width; rich content may fill its cap.
  agentFrame: {
    alignSelf: "flex-start",
    flexShrink: 1,
    gap: spacing.optical,
    maxWidth: "100%",
    minWidth: 0,
  },
  agentFrameFill: {
    flexBasis: 0,
    flexGrow: 1,
  },
  agentFrameWithFooter: {
    marginBottom: spacing.xs,
  },
  agentSurface: {
    alignSelf: "stretch",
    backgroundColor: colors.messageSurface,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  content: { minWidth: 0 },
  segmentedAgentSurface: {
    borderRadius: 0,
    paddingBottom: 0,
    paddingTop: 0,
  },
  segmentedAgentSurfaceEnd: {
    borderBottomLeftRadius: radii.selected,
    borderBottomRightRadius: radii.selected,
    paddingBottom: spacing.sm,
  },
  segmentedAgentSurfaceStart: {
    borderTopLeftRadius: radii.selected,
    borderTopRightRadius: radii.selected,
    paddingTop: spacing.xs,
  },
  userSurface: {
    alignSelf: "flex-end",
    backgroundColor: colors.messageSurface,
    maxWidth: "82%",
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
});
