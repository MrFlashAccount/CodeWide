import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { desktopThreadSidebarWidth, isDesktopWindow } from "./windowLayout";

interface ThreadCatalogWorkspaceViewProps {
  catalog: ReactNode;
}

export function ServerWorkspaceView({
  children,
  rail,
}: PropsWithChildren<{ rail: ReactNode }>): React.JSX.Element {
  const window = useWindowDimensions();
  if (!isDesktopWindow(window)) return <View style={styles.root}>{children}</View>;
  return (
    <View style={styles.row}>
      {rail}
      <View style={styles.main}>{children}</View>
    </View>
  );
}

export function WorkspaceSafeAreaView({ children }: PropsWithChildren): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.safeArea, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
      {children}
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
  const window = useWindowDimensions();
  if (!isDesktopWindow(window)) return <View style={styles.root}>{children}</View>;
  return (
    <View style={styles.row}>
      <View style={[styles.sidebar, { width: desktopThreadSidebarWidth(window.width) }]}>
        {sidebar}
      </View>
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

export function ThreadCatalogWorkspaceView({
  catalog,
}: ThreadCatalogWorkspaceViewProps): React.JSX.Element {
  const window = useWindowDimensions();
  if (!isDesktopWindow(window)) return <View style={styles.root}>{catalog}</View>;
  return (
    <View style={styles.row}>
      <View style={[styles.sidebar, { width: desktopThreadSidebarWidth(window.width) }]}>
        {catalog}
      </View>
      <View style={styles.main}>
        <View style={styles.empty}>
          <PresentationIcon color={colors.textDim} name="chat" size={28} />
          <ProductText tone="muted">Select a thread</ProductText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", flex: 1, gap: spacing.sm, justifyContent: "center" },
  main: { backgroundColor: colors.background, flex: 1, minWidth: 0 },
  root: { flex: 1, minHeight: 0 },
  row: { flex: 1, flexDirection: "row", minHeight: 0 },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  sidebar: { backgroundColor: colors.surface, flexShrink: 0 },
});
