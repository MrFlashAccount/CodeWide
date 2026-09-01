import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, radii, spacing } from "../theme";
export type BubbleVariant = "agent" | "user";

interface BubbleProps {
  children: ReactNode;
  errorContext?: string;
  errorLabel?: string;
  errorResetKey?: string;
  fill?: boolean;
  testID?: string;
  variant: BubbleVariant;
}

interface BubbleContentProps {
  children: ReactNode;
}

/**
 * A purely declarative bubble surface. Yoga owns both axes; this component
 * never measures content or writes computed width/height back into layout.
 */
export function Bubble(props: BubbleProps): React.JSX.Element {
  const { children, fill = false, testID, variant } = props;
  const surfaceStyle = [
    styles.surface,
    variant === "agent" ? styles.agentSurface : styles.userSurface,
    variant === "agent" && fill ? styles.agentSurfaceFill : null,
  ];
  return (
    <View testID={testID} style={surfaceStyle}>
      {children}
    </View>
  );
}

export function BubbleContent(props: BubbleContentProps): React.JSX.Element {
  const { children } = props;
  return <View style={styles.content}>{children}</View>;
}

const styles = StyleSheet.create({
  surface: {
    minWidth: 0,
    borderRadius: radii.selected,
  },
  agentSurface: {
    maxWidth: "88%",
    flexShrink: 1,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    backgroundColor: colors.surface,
  },
  agentSurfaceFill: {
    width: "88%",
    flexShrink: 0,
  },
  userSurface: {
    maxWidth: "82%",
    alignSelf: "flex-end",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  content: { minWidth: 0 },
});
