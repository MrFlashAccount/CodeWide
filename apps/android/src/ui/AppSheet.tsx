import {
  BottomSheet,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetProps,
} from "@expo/ui/community/bottom-sheet";
import { PortalHost } from "heroui-native/portal";
import { useId, type ReactNode } from "react";
import {
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, radii, spacing } from "../theme";
import { OverlaySurfaceProvider } from "./OverlaySurfaceContext";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";

const SHEET_MAX_WIDTH = 580;
const SHEET_FRAME_MAX_WIDTH = SHEET_MAX_WIDTH + spacing.md * 2;

type AppSheetContentProps = Omit<
  BottomSheetProps,
  "children" | "index" | "onChange" | "onClose" | "onDismiss" | "ref"
> & {
  index?: number;
  /** Compatibility-only HeroUI props. Geometry now belongs to native Material 3. */
  className?: string;
  backgroundClassName?: string;
  contentContainerClassName?: string;
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
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.handleArea}>
              <View style={styles.handle} />
            </View>
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

export function AppSheetScrollView({ nestedScrollEnabled = true, ...props }: ScrollViewProps) {
  return <BottomSheetScrollView nestedScrollEnabled={nestedScrollEnabled} {...props} />;
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
    paddingBottom: spacing.sm,
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
    borderRadius: 32,
  },
  expandedSurface: {
    flex: 1,
    minHeight: 0,
  },
  handleArea: {
    height: 24,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textDim,
  },
});
