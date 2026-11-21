import { createContext, type ReactNode, useContext } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { AppText } from "../ui/AppText";
import { colors, radii, spacing, typeScale } from "../theme";
import { RecoverableRenderBoundary } from "../ui/RecoverableRenderBoundary";
import { surfaceToneMessageStyle, useSurfaceTone } from "../ui/surfaceTone";
import { FluidLayoutFrame } from "./FluidLayoutFrame";

export type BubbleVariant = "agent" | "user";

const InsideBubbleSurfaceContext = createContext(false);

export function useInsideBubbleSurface(): boolean {
  return useContext(InsideBubbleSurfaceContext);
}

type AgentSurfaceProps = {
  animateLayout?: boolean;
  children: ReactNode;
  fill?: boolean;
  footer?: ReactNode;
  segment?: "end" | "middle" | "single" | "start";
  staticLayout?: boolean;
  testID?: string | undefined;
};

/** Bubble with its own recovery boundary for standalone or optimistic messages. */
export function Bubble({
  errorContext,
  errorLabel,
  errorResetKey,
  variant,
  ...surface
}: AgentSurfaceProps & {
  errorContext?: string;
  errorLabel?: string;
  errorResetKey?: string;
  variant: BubbleVariant;
}): React.JSX.Element {
  return (
    <RecoverableRenderBoundary
      label={errorLabel ?? (variant === "agent" ? "Agent message" : "User message")}
      scope="bubble"
      {...(errorContext === undefined ? {} : { context: errorContext })}
      resetKey={errorResetKey ?? `${variant}:${surface.testID ?? "bubble"}`}
    >
      {variant === "agent" ? (
        <AgentBubbleSurface {...surface} />
      ) : (
        <UserBubbleSurface testID={surface.testID}>{surface.children}</UserBubbleSurface>
      )}
    </RecoverableRenderBoundary>
  );
}

/** Agent body and footer share an intrinsic width. Historical messages use ordinary Yoga views. */
export function AgentBubbleSurface({
  animateLayout = false,
  children,
  fill = false,
  footer,
  segment = "single",
  staticLayout = false,
  testID,
}: AgentSurfaceProps): React.JSX.Element {
  const tone = useSurfaceTone();
  const surfaceStyle = [
    styles.surface,
    styles.agentSurface,
    surfaceToneMessageStyle(tone),
    segment !== "single" && styles.segmentedAgentSurface,
    segment === "start" && styles.segmentedAgentSurfaceStart,
    segment === "end" && styles.segmentedAgentSurfaceEnd,
  ];
  return (
    <View
      style={[
        styles.agentFrame,
        fill && styles.agentFrameFill,
        footer !== null && footer !== undefined && styles.agentFrameWithFooter,
      ]}
      testID={staticLayout ? undefined : "agent-bubble-frame"}
    >
      {staticLayout ? (
        <View style={surfaceStyle} testID={testID}>
          {children}
        </View>
      ) : (
        <FluidLayoutFrame animate={animateLayout} style={surfaceStyle} testID={testID}>
          {children}
        </FluidLayoutFrame>
      )}
      {renderAgentFooter(footer, staticLayout)}
    </View>
  );
}

function renderAgentFooter(footer: ReactNode, staticLayout: boolean): ReactNode {
  if (staticLayout || footer === null || footer === undefined) {
    return footer;
  }
  return <FluidLayoutFrame animate={false}>{footer}</FluidLayoutFrame>;
}

/** User bubble under the enclosing message recovery boundary, with one native surface for its content. */
export function UserBubbleSurface({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string | undefined;
}): React.JSX.Element {
  const tone = useSurfaceTone();
  return (
    <InsideBubbleSurfaceContext.Provider value>
      <View
        style={[styles.surface, styles.userSurface, surfaceToneMessageStyle(tone), style]}
        testID={testID}
      >
        {children}
      </View>
    </InsideBubbleSurfaceContext.Provider>
  );
}

/** Ordinary selectable text can paint its bubble in the same native view. */
export function UserTextBubble({ text }: { text: string }): React.JSX.Element {
  const tone = useSurfaceTone();
  return (
    <AppText
      selectable
      style={[styles.surface, styles.userSurface, surfaceToneMessageStyle(tone), styles.plainText]}
      testID="user-bubble"
    >
      {text}
    </AppText>
  );
}

export function BubbleContent({
  children,
  style,
  ...viewProps
}: React.ComponentProps<typeof View>) {
  return (
    <InsideBubbleSurfaceContext.Provider value>
      <View {...viewProps} style={[styles.content, style]}>
        {children}
      </View>
    </InsideBubbleSurfaceContext.Provider>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: radii.bubble,
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  content: { minWidth: 0 },
  plainText: {
    color: colors.text,
    ...typeScale.body,
  },
  segmentedAgentSurface: {
    borderRadius: 0,
    paddingBottom: 0,
    paddingTop: 0,
  },
  segmentedAgentSurfaceEnd: {
    borderBottomLeftRadius: radii.bubble,
    borderBottomRightRadius: radii.bubble,
    paddingBottom: spacing.sm,
  },
  segmentedAgentSurfaceStart: {
    borderTopLeftRadius: radii.bubble,
    borderTopRightRadius: radii.bubble,
    paddingTop: spacing.sm,
  },
  userSurface: {
    alignSelf: "flex-end",
    backgroundColor: colors.messageSurface,
    maxWidth: "82%",
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
});
