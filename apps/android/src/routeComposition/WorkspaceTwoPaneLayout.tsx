import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import Reanimated, { LinearTransition } from "react-native-reanimated";

import { desktopThreadSidebarWidth } from "../presentation/layouts/windowLayout";

/** Responsive placement of one catalog and its adjacent workspace detail. */
export type WorkspaceTwoPanePresentation =
  | { readonly kind: "catalogOnly" }
  | { readonly kind: "detailOnly" }
  | { readonly kind: "stacked" }
  | { readonly kind: "wideDetailExpanded" }
  | { readonly kind: "wide"; readonly viewportWidth: number };

const PANE_TRANSITION_DURATION_MS = 220;
const PANE_TRANSITION = LinearTransition.duration(PANE_TRANSITION_DURATION_MS);

type WorkspacePaneViewProps = Pick<
  ViewProps,
  | "accessibilityElementsHidden"
  | "collapsable"
  | "importantForAccessibility"
  | "onLayout"
  | "pointerEvents"
  | "testID"
>;

/**
 * Shared geometry for the Threads and Pull requests catalog/detail pairs.
 * Callers retain navigation, lifetime, interaction and surface ownership.
 */
export function WorkspaceTwoPaneLayout({
  catalog,
  catalogStyle,
  catalogViewProps,
  detail,
  detailStyle: detailSurfaceStyle,
  detailViewProps,
  overlay,
  presentation,
  testID,
}: {
  readonly catalog: ReactElement | null;
  readonly catalogStyle?: StyleProp<ViewStyle>;
  readonly catalogViewProps: WorkspacePaneViewProps;
  readonly detail: ReactElement | null;
  readonly detailStyle?: StyleProp<ViewStyle>;
  readonly detailViewProps: WorkspacePaneViewProps;
  readonly overlay?: ReactNode;
  readonly presentation: WorkspaceTwoPanePresentation;
  readonly testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.frame} testID={testID}>
      <Reanimated.View
        {...catalogViewProps}
        layout={PANE_TRANSITION}
        style={[catalogPaneStyle(presentation), catalogStyle]}
      >
        {catalog}
      </Reanimated.View>
      <Reanimated.View
        {...detailViewProps}
        layout={PANE_TRANSITION}
        style={[detailPaneStyle(presentation), detailSurfaceStyle]}
      >
        {detail}
      </Reanimated.View>
      {overlay}
    </View>
  );
}

function catalogPaneStyle(presentation: WorkspaceTwoPanePresentation): StyleProp<ViewStyle> {
  if (presentation.kind === "catalogOnly") {
    return styles.fill;
  }
  if (presentation.kind === "detailOnly") {
    return styles.hidden;
  }
  if (presentation.kind === "wideDetailExpanded") {
    return styles.collapsed;
  }
  if (presentation.kind === "stacked") {
    return StyleSheet.absoluteFill;
  }
  return [styles.catalog, { width: desktopThreadSidebarWidth(presentation.viewportWidth) }];
}

function detailPaneStyle(presentation: WorkspaceTwoPanePresentation): StyleProp<ViewStyle> {
  return presentation.kind === "catalogOnly" ? styles.hidden : styles.detail;
}

const styles = StyleSheet.create({
  catalog: {
    flexShrink: 0,
  },
  collapsed: {
    overflow: "hidden",
    width: 0,
  },
  detail: {
    flex: 1,
    minWidth: 0,
  },
  fill: {
    flex: 1,
  },
  frame: {
    flex: 1,
    flexDirection: "row",
  },
  hidden: {
    display: "none",
  },
});
