import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";

import { colors, spacing } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";

const WIDE_WORKSPACE_MIN_WIDTH = 900;

export function ServerWorkspaceView({
  children,
  rail,
}: PropsWithChildren<{ rail: ReactNode }>): React.JSX.Element {
  const { width } = useWindowDimensions();
  if (width < WIDE_WORKSPACE_MIN_WIDTH) return <View style={styles.root}>{children}</View>;
  return (
    <View style={styles.row}>
      {rail}
      <View style={styles.main}>{children}</View>
    </View>
  );
}

export function SavedServerWorkspaceView({
  children,
  emptyMain,
  sidebar,
}: PropsWithChildren<{
  emptyMain: boolean;
  sidebar: ReactNode;
}>): React.JSX.Element {
  const { width } = useWindowDimensions();
  if (width < WIDE_WORKSPACE_MIN_WIDTH) return <View style={styles.root}>{children}</View>;
  return (
    <View style={styles.row}>
      <View style={styles.sidebar}>{sidebar}</View>
      <View style={styles.main}>
        {emptyMain ? (
          <View style={styles.empty}>
            <PresentationIcon color={colors.textDim} name="chat" size={28} />
            <ProductText tone="muted">Select a thread</ProductText>
          </View>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", flex: 1, gap: spacing.sm, justifyContent: "center" },
  main: { backgroundColor: colors.background, flex: 1, minWidth: 0 },
  root: { flex: 1, minHeight: 0 },
  row: { flex: 1, flexDirection: "row", minHeight: 0 },
  sidebar: { backgroundColor: colors.surface, flexShrink: 0, width: 340 },
});
