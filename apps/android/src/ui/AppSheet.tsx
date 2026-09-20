import {
  BottomSheet,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetProps,
} from "@expo/ui/community/bottom-sheet";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { SheetBackProvider, useSheetDismissController } from "./sheetNavigation";
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
  backgroundClassName?: string;
  bottomInset?: number;
  /** Compatibility props retained by existing sheet callers; native Material owns geometry. */
  className?: string;
  contentContainerClassName?: string;
  detached?: boolean;
  /** Accessible name of the dismissible drag handle. */
  dismissLabel?: string;
  index?: number;
  maxDynamicContentSize?: number;
  performanceSurface?: SheetPerformanceSurface;
  style?: StyleProp<ViewStyle>;
  topInset?: number;
};

type AppSheetProps = {
  children: ReactNode;
  contentProps: AppSheetContentProps;
  isOpen: boolean;
  onDismissRequest?: () => void;
  onOpenChange: (isOpen: boolean) => void;
};

export function AppSheet({
  children,
  contentProps,
  isOpen,
  onDismissRequest,
  onOpenChange,
}: AppSheetProps) {
  const expanded = contentProps.enableDynamicSizing === false;
  const detached = contentProps.detached ?? true;
  const dismiss = useSheetDismissController(() => {
    onOpenChange(false);
  }, onDismissRequest);

  return (
    <BottomSheet
      index={isOpen ? (contentProps.index ?? 0) : -1}
      {...(contentProps.snapPoints === undefined ? {} : { snapPoints: contentProps.snapPoints })}
      enableDynamicSizing={contentProps.enableDynamicSizing ?? true}
      {...(contentProps.enableOverDrag === undefined
        ? {}
        : { enableOverDrag: contentProps.enableOverDrag })}
      backgroundStyle={styles.sheetBackground}
      enablePanDownToClose={contentProps.enablePanDownToClose ?? true}
      handleComponent={null}
      onClose={() => {
        onOpenChange(false);
      }}
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
              accessibilityLabel={contentProps.dismissLabel ?? "Dismiss sheet"}
              accessibilityRole="button"
              disabled={contentProps.enablePanDownToClose === false}
              onAccessibilityEscape={
                contentProps.enablePanDownToClose === false
                  ? undefined
                  : () => {
                      dismiss.requestDismiss();
                    }
              }
              onPress={() => {
                dismiss.requestDismiss();
              }}
              style={styles.handleArea}
            >
              <View style={styles.handle} />
            </Pressable>
            <OverlaySurfaceProvider surface="native-sheet">
              <RecoverableRenderBoundary
                label="Bottom sheet content"
                resetKey={isOpen ? "open" : "closed"}
                scope="dialog"
              >
                <SheetBackProvider register={dismiss.register}>{children}</SheetBackProvider>
              </RecoverableRenderBoundary>
            </OverlaySurfaceProvider>
          </View>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

/** Also serves as LegendList's scroll host, preserving its ref, events and sheet gesture handoff. */
export function AppSheetScrollView(props: ComponentPropsWithRef<typeof BottomSheetScrollView>) {
  return (
    <BottomSheetScrollView {...props} nestedScrollEnabled={props.nestedScrollEnabled ?? true} />
  );
}

const styles = StyleSheet.create({
  detachedSurface: {
    borderRadius: radii.large,
  },
  expandedFrame: {
    flex: 1,
    minHeight: 0,
  },
  expandedInset: {
    flex: 1,
    minHeight: 0,
  },
  expandedSurface: {
    flex: 1,
    minHeight: 0,
    paddingBottom: 0,
  },
  frame: {
    minWidth: 0,
    width: "100%",
  },
  handle: {
    backgroundColor: colors.textDim,
    borderRadius: radii.compact,
    height: 4,
    width: 36,
  },
  handleArea: {
    alignItems: "center",
    flexShrink: 0,
    height: layoutSize.metadataRow,
    justifyContent: "center",
  },
  inset: {
    alignSelf: "center",
    maxWidth: SHEET_FRAME_MAX_WIDTH,
    minWidth: 0,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  sheetBackground: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  surface: {
    alignSelf: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.composer,
    maxWidth: SHEET_MAX_WIDTH,
    minWidth: 0,
    overflow: "hidden",
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
});
