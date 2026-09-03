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

interface SavedServerIndexViewProps {
  catalog: ReactNode;
}

export function ServerWorkspaceView(
  props: PropsWithChildren<{ rail: ReactNode }>,
): React.JSX.Element {
  const { children, rail } = props;
  const window = useWindowDimensions();
  const desktop = isDesktopWindow(window);
  return (
    <View style={styles.row}>
      {desktop ? rail : null}
      <View style={styles.main}>{children}</View>
    </View>
  );
}

export function WorkspaceSafeAreaView(props: PropsWithChildren): React.JSX.Element {
  const { children } = props;
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.safeArea,
        {
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingTop: insets.top,
        },
      ]}
    >
      {children}
    </View>
  );
}

export function SavedServerWorkspaceView(
  props: PropsWithChildren<{
    sidebar: ReactNode;
  }>,
): React.JSX.Element {
  const { children, sidebar } = props;
  const window = useWindowDimensions();
  const desktop = isDesktopWindow(window);
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.sidebar,
          { width: desktopThreadSidebarWidth(window.width) },
          desktop ? undefined : styles.hidden,
        ]}
      >
        {sidebar}
      </View>
      <View style={styles.main}>{children}</View>
    </View>
  );
}

export function SavedServerIndexView(props: SavedServerIndexViewProps): React.JSX.Element {
  const { catalog } = props;
  const window = useWindowDimensions();
  if (!isDesktopWindow(window)) return <View style={styles.root}>{catalog}</View>;
  return (
    <View style={styles.empty}>
      <PresentationIcon color={colors.textDim} name="chat" size={28} />
      <ProductText tone="muted">Select a thread</ProductText>
    </View>
  );
}

export function ThreadCatalogWorkspaceView(
  props: ThreadCatalogWorkspaceViewProps,
): React.JSX.Element {
  const { catalog } = props;
  const window = useWindowDimensions();
  const desktop = isDesktopWindow(window);
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.sidebar,
          desktop ? { width: desktopThreadSidebarWidth(window.width) } : styles.narrowCatalog,
        ]}
      >
        {catalog}
      </View>
      <View style={[styles.main, desktop ? undefined : styles.hidden]}>
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
  hidden: { display: "none" },
  main: { backgroundColor: colors.background, flex: 1, minWidth: 0 },
  narrowCatalog: { flex: 1 },
  root: { flex: 1, minHeight: 0 },
  row: { flex: 1, flexDirection: "row", minHeight: 0 },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  sidebar: { backgroundColor: colors.surface, flexShrink: 0 },
});
