import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, radii } from "../theme";
import { RecoverableRenderBoundary } from "../ui/RecoverableRenderBoundary";

export type BubbleVariant = "agent" | "user";

/**
 * A purely declarative bubble surface. Yoga owns both axes; this component
 * never measures content or writes computed width/height back into layout.
 */
export function Bubble({
  variant,
  fill = false,
  testID,
  errorLabel,
  errorContext,
  errorResetKey,
  children,
}: {
  variant: BubbleVariant;
  fill?: boolean;
  testID?: string;
  errorLabel?: string;
  errorContext?: string;
  errorResetKey?: string;
  children: ReactNode;
}) {
  return (
    <RecoverableRenderBoundary
      scope="bubble"
      label={errorLabel ?? (variant === "agent" ? "Agent message" : "User message")}
      {...(errorContext === undefined ? {} : { context: errorContext })}
      resetKey={errorResetKey ?? `${variant}:${testID ?? "bubble"}`}
    >
    <View
      testID={testID}
      style={[
        styles.surface,
        variant === "agent" ? styles.agentSurface : styles.userSurface,
        variant === "agent" && fill ? styles.agentSurfaceFill : null,
      ]}
    >
      {children}
    </View>
    </RecoverableRenderBoundary>
  );
}

export function BubbleContent({ children }: { children: ReactNode }) {
  return <View style={styles.content}>{children}</View>;
}

const styles = StyleSheet.create({
  surface: {
    minWidth: 0,
    borderRadius: radii.selected,
  },
  agentSurface: {
    maxWidth: "88%",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 8,
    backgroundColor: colors.surface,
  },
  agentSurfaceFill: {
    width: "88%",
    flexShrink: 0,
  },
  userSurface: {
    maxWidth: "82%",
    alignSelf: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 9,
    backgroundColor: colors.surfaceRaised,
  },
  content: { minWidth: 0 },
});
