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
  variant,
  fill = false,
  animateLayout = false,
  testID,
  errorLabel,
  errorContext,
  errorResetKey,
  footer,
  children,
}: {
  variant: BubbleVariant;
  fill?: boolean;
  animateLayout?: boolean;
  testID?: string;
  errorLabel?: string;
  errorContext?: string;
  errorResetKey?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const surfaceStyle = [
    styles.surface,
    variant === "agent" ? styles.agentSurface : styles.userSurface,
  ];
  return (
    <RecoverableRenderBoundary
      scope="bubble"
      label={errorLabel ?? (variant === "agent" ? "Agent message" : "User message")}
      {...(errorContext === undefined ? {} : { context: errorContext })}
      resetKey={errorResetKey ?? `${variant}:${testID ?? "bubble"}`}
    >
      {variant === "agent" ? (
        <View
          testID="agent-bubble-frame"
          style={[
            styles.agentFrame,
            fill && styles.agentFrameFill,
            footer != null && styles.agentFrameWithFooter,
          ]}
        >
          <FluidLayoutFrame animate={animateLayout} testID={testID} style={surfaceStyle}>
            {children}
          </FluidLayoutFrame>
          {footer != null && <FluidLayoutFrame animate={animateLayout}>{footer}</FluidLayoutFrame>}
        </View>
      ) : (
        <View testID={testID} style={surfaceStyle}>
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
    minWidth: 0,
    borderRadius: radii.selected,
  },
  // The body and footer share one intrinsic width; rich content may fill its cap.
  agentFrame: {
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
    alignSelf: "flex-start",
    gap: spacing.optical,
  },
  agentFrameWithFooter: {
    marginBottom: spacing.xs,
  },
  agentFrameFill: {
    flexGrow: 1,
    flexBasis: 0,
  },
  agentSurface: {
    alignSelf: "stretch",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    backgroundColor: colors.messageSurface,
  },
  userSurface: {
    maxWidth: "82%",
    alignSelf: "flex-end",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    backgroundColor: colors.messageSurface,
  },
  content: { minWidth: 0 },
});
