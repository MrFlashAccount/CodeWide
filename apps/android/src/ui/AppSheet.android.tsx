import type { BottomSheetProps } from "@expo/ui/community/bottom-sheet";
import {
  Host,
  ModalBottomSheet,
  RNHostView,
  type ModalBottomSheetRef,
} from "@expo/ui/jetpack-compose";
import { PortalHost } from "heroui-native/portal";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
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
  const { width } = useWindowDimensions();
  const sheetRef = useRef<ModalBottomSheetRef>(null);
  const [nativeSheetReady, setNativeSheetReady] = useState(false);
  const expanded = contentProps.enableDynamicSizing === false;
  const detached = contentProps.detached ?? true;
  const fitToContents = contentProps.enableDynamicSizing !== false
    && (contentProps.snapPoints === undefined || contentProps.snapPoints.length === 0);
  const hasMultipleSnapPoints = (contentProps.snapPoints?.length ?? 0) > 1;
  const maxIndex = Math.max(0, (contentProps.snapPoints?.length ?? 1) - 1);
  const initialFullyExpanded = hasMultipleSnapPoints && (contentProps.index ?? 0) === maxIndex;
  const portalHostName = `app-sheet-${useId()}`;
  const setSheetRef = useCallback((sheet: ModalBottomSheetRef | null) => {
    sheetRef.current = sheet;
    setNativeSheetReady(sheet !== null);
  }, []);

  useEffect(() => {
    if (isOpen || !nativeSheetReady) return;

    let cancelled = false;
    void sheetRef.current?.hide().catch(() => undefined).then(() => {
      if (!cancelled) setNativeSheetReady(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, nativeSheetReady]);

  if (!isOpen && !nativeSheetReady) return null;

  return (
    <Host colorScheme="dark" pointerEvents="none" style={{ position: "absolute", width }}>
      <ModalBottomSheet
        ref={setSheetRef}
        onDismissRequest={() => {
          setNativeSheetReady(false);
          onOpenChange(false);
        }}
        skipPartiallyExpanded={fitToContents || !hasMultipleSnapPoints}
        initialFullyExpanded={initialFullyExpanded}
        showDragHandle={false}
        sheetGesturesEnabled={contentProps.enablePanDownToClose ?? true}
        containerColor={colors.surfaceContainerHigh}
        contentColor={colors.text}
        scrimColor={colors.scrim}
        properties={{
          shouldDismissOnBackPress: contentProps.enablePanDownToClose ?? true,
          shouldDismissOnClickOutside: contentProps.enablePanDownToClose ?? true,
        }}
      >
        <RNHostView matchContents={fitToContents}>
          <View style={[styles.frame, expanded && styles.expandedFrame, !fitToContents && styles.fixedHostContent]}>
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
          </View>
        </RNHostView>
      </ModalBottomSheet>
    </Host>
  );
}

export function AppSheetScrollView({ nestedScrollEnabled = true, ...props }: ScrollViewProps) {
  return <ScrollView nestedScrollEnabled={nestedScrollEnabled} {...props} />;
}

const styles = StyleSheet.create({
  frame: { width: "100%", minWidth: 0 },
  expandedFrame: { flex: 1, minHeight: 0 },
  fixedHostContent: { flexGrow: 1, height: 0 },
  inset: {
    width: "100%",
    maxWidth: SHEET_FRAME_MAX_WIDTH,
    minWidth: 0,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  expandedInset: { flex: 1, minHeight: 0 },
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
  detachedSurface: { borderRadius: 32 },
  expandedSurface: { flex: 1, minHeight: 0 },
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
