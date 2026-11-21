/**
 * Stand-in for `src/ui/AppSheet` inside the browser preview bundle. The web
 * AppSheet wraps a different bottom-sheet library with extra frame insets and
 * no height cap; this mirrors the Android Material sheet the product ships
 * (`AppSheet.android.tsx`): full width up to 640dp, drag handle, 16dp content
 * inset, capped height with the caller's own scroll view inside.
 */
import type { ComponentPropsWithRef, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, spacing } from "../../src/theme";

const SHEET_MAX_WIDTH = 640;
const SHEET_TOP_RADIUS = 28;
const MAX_HEIGHT_SHARE = 0.9;

export function AppSheet({
  children,
  contentProps,
  isOpen,
  onOpenChange,
}: {
  readonly children: ReactNode;
  readonly contentProps: { readonly dismissLabel?: string; readonly style?: StyleProp<ViewStyle> };
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}): React.JSX.Element | null {
  if (!isOpen) {
    return null;
  }
  // The Material sheet is a window above the whole app, including the catalog's bottom bar.
  return createPortal(
    <View style={[styles.overlay, { height: window.innerHeight, width: window.innerWidth }]}>
      <Pressable
        accessibilityLabel={contentProps.dismissLabel ?? "Dismiss sheet"}
        onPress={() => {
          onOpenChange(false);
        }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.sheet, { maxHeight: window.innerHeight * MAX_HEIGHT_SHARE }]}>
        <View style={styles.handleArea}>
          <View style={styles.handle} />
        </View>
        <View style={[styles.content, contentProps.style]}>{children}</View>
      </View>
    </View>,
    sheetRoot(),
  );
}

/** A fixed full-viewport layer appended to the page once. */
function sheetRoot(): HTMLElement {
  const existing = document.getElementById("preview-sheet-root");
  if (existing !== null) {
    return existing;
  }
  const root = document.createElement("div");
  root.id = "preview-sheet-root";
  root.style.cssText = "position:fixed;inset:0;z-index:10;pointer-events:none";
  document.body.append(root);
  return root;
}

export function AppSheetScrollView(props: ComponentPropsWithRef<typeof ScrollView>): React.JSX.Element {
  return <ScrollView {...props} />;
}

const styles = StyleSheet.create({
  content: {
    flexShrink: 1,
    minHeight: 0,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  handle: {
    backgroundColor: colors.textDim,
    borderRadius: 2,
    height: 4,
    width: 32,
  },
  handleArea: {
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  overlay: {
    backgroundColor: colors.scrim,
    justifyContent: "flex-end",
    pointerEvents: "auto",
  },
  sheet: {
    alignSelf: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderTopLeftRadius: SHEET_TOP_RADIUS,
    borderTopRightRadius: SHEET_TOP_RADIUS,
    maxWidth: SHEET_MAX_WIDTH,
    width: "100%",
  },
});
