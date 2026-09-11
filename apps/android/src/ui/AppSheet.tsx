import {
  BottomSheet,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetProps,
} from "@expo/ui/community/bottom-sheet";
import { PortalHost } from "heroui-native/portal";
import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, radii, spacing, layoutSize } from "../theme";
import type { SheetPerformanceSurface } from "../presentation/diagnostics/sheetPerformanceSurface";
import { OverlaySurfaceProvider } from "./OverlaySurfaceContext";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";

const SHEET_MAX_WIDTH = 580;
const SHEET_FRAME_MAX_WIDTH = SHEET_MAX_WIDTH + spacing.md * 2;

type AppSheetContentProps = Omit<
  BottomSheetProps,
  "children" | "index" | "onChange" | "onClose" | "onDismiss" | "ref"
> & {
  index?: number;
  performanceSurface?: SheetPerformanceSurface;
  /** Compatibility-only HeroUI props. Geometry now belongs to native Material 3. */
  className?: string;
  backgroundClassName?: string;
  contentContainerClassName?: string;
  /** Accessible name of the dismissible drag handle. */
  dismissLabel?: string;
  detached?: boolean;
  topInset?: number;
  bottomInset?: number;
  maxDynamicContentSize?: number;
  style?: StyleProp<ViewStyle>;
};

type AppSheetProps = {
  isOpen: boolean;
  onOpenChange(isOpen: boolean): void;
  children: ReactNode;
  contentProps: AppSheetContentProps;
};

export function AppSheet({ isOpen, onOpenChange, children, contentProps }: AppSheetProps) {
  const expanded = contentProps.enableDynamicSizing === false;
  const detached = contentProps.detached ?? true;
  const portalHostName = `app-sheet-${useId()}`;

  return (
    <BottomSheet
      index={isOpen ? contentProps.index ?? 0 : -1}
      {...(contentProps.snapPoints === undefined ? {} : { snapPoints: contentProps.snapPoints })}
      enableDynamicSizing={contentProps.enableDynamicSizing ?? true}
      {...(contentProps.enableOverDrag === undefined ? {} : { enableOverDrag: contentProps.enableOverDrag })}
      enablePanDownToClose={contentProps.enablePanDownToClose ?? true}
      handleComponent={null}
      backgroundStyle={styles.sheetBackground}
      onClose={() => onOpenChange(false)}
    >
      <BottomSheetView style={[styles.frame, expanded && styles.expandedFrame]}>
        <View style={[styles.inset, expanded && styles.expandedInset]}>
          <View
            style={[
              styles.surface,
              detached && styles.detachedSurface,
              expanded && styles.expandedSurface,
              contentProps.style,
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={contentProps.dismissLabel ?? "Dismiss sheet"}
              disabled={contentProps.enablePanDownToClose === false}
              onPress={() => onOpenChange(false)}
              onAccessibilityEscape={contentProps.enablePanDownToClose === false ? undefined : () => onOpenChange(false)}
              style={styles.handleArea}
            >
              <View style={styles.handle} />
            </Pressable>
            <OverlaySurfaceProvider surface="native-sheet" portalHostName={portalHostName}>
              <RecoverableRenderBoundary
                scope="dialog"
                label="Bottom sheet content"
                resetKey={isOpen ? "open" : "closed"}
              >
                {children}
              </RecoverableRenderBoundary>
              <PortalHost name={portalHostName} />
            </OverlaySurfaceProvider>
          </View>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

/** Also serves as LegendList's scroll host, preserving its ref, events and sheet gesture handoff. */
export function AppSheetScrollView(props: ComponentPropsWithRef<typeof BottomSheetScrollView>) {
  return <BottomSheetScrollView {...props} nestedScrollEnabled={props.nestedScrollEnabled ?? true} />;
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  frame: {
    width: "100%",
    minWidth: 0,
  },
  expandedFrame: {
    flex: 1,
    minHeight: 0,
  },
  inset: {
    width: "100%",
    maxWidth: SHEET_FRAME_MAX_WIDTH,
    minWidth: 0,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
  },
  expandedInset: {
    flex: 1,
    minHeight: 0,
  },
  surface: {
    width: "100%",
    maxWidth: SHEET_MAX_WIDTH,
    minWidth: 0,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    overflow: "hidden",
    borderRadius: radii.composer,
    backgroundColor: colors.surfaceContainerHigh,
  },
  detachedSurface: {
    borderRadius: radii.large,
  },
  expandedSurface: {
    flex: 1,
    minHeight: 0,
    paddingBottom: 0,
  },
  handleArea: {
    height: layoutSize.metadataRow,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: radii.compact,
    backgroundColor: colors.textDim,
  },
});
