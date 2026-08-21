import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, radii } from "../theme";

export type BubbleVariant = "agent" | "user";

/**
 * A purely declarative bubble surface. Yoga owns both axes; this component
 * never measures content or writes computed width/height back into layout.
 */
export function Bubble({
  variant,
  testID,
  children,
}: {
  variant: BubbleVariant;
  testID?: string;
  children: ReactNode;
}) {
  return (
    <View
      testID={testID}
      style={[styles.surface, variant === "agent" ? styles.agentSurface : styles.userSurface]}
    >
      {children}
    </View>
  );
}

export function BubbleContent({ children }: { children: ReactNode }) {
  return <View style={styles.content}>{children}</View>;
}

const styles = StyleSheet.create({
  surface: {
    minWidth: 0,
    maxWidth: "100%",
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
  userSurface: {
    maxWidth: "82%",
    alignSelf: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 9,
    backgroundColor: colors.surfaceRaised,
  },
  content: { minWidth: 0, maxWidth: "100%" },
});
