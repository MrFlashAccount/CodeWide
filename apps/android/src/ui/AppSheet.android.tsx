import type { BottomSheetProps } from "@expo/ui/community/bottom-sheet";
import {
  Host,
  ModalBottomSheet,
  RNHostView,
  type ModalBottomSheetRef,
} from "@expo/ui/jetpack-compose";
import { PortalHost } from "heroui-native/portal";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { spacing } from "../theme";
import type { SheetPerformanceSurface } from "../presentation/diagnostics/sheetPerformanceSurface";
import { OverlaySurfaceProvider } from "./OverlaySurfaceContext";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";

type AppSheetContentProps = Omit<
  BottomSheetProps,
  "children" | "index" | "onChange" | "onClose" | "onDismiss" | "ref"
> & {
  index?: number;
  performanceSurface?: SheetPerformanceSurface;
  className?: string;
  backgroundClassName?: string;
  contentContainerClassName?: string;
  /** Non-Android compatibility; Material owns the native handle semantics. */
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
  const { width } = useWindowDimensions();
  const sheetRef = useRef<ModalBottomSheetRef>(null);
  const [nativeSheetReady, setNativeSheetReady] = useState(false);
  const expanded = contentProps.enableDynamicSizing === false;
  const fitToContents =
    contentProps.enableDynamicSizing !== false &&
    (contentProps.snapPoints === undefined || contentProps.snapPoints.length === 0);
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
    void sheetRef.current
      ?.hide()
      .catch(() => undefined)
      .then(() => {
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
        showDragHandle={contentProps.enablePanDownToClose ?? true}
        sheetGesturesEnabled={contentProps.enablePanDownToClose ?? true}
        properties={{
          shouldDismissOnBackPress: contentProps.enablePanDownToClose ?? true,
          shouldDismissOnClickOutside: contentProps.enablePanDownToClose ?? true,
        }}
      >
        <RNHostView matchContents={fitToContents}>
          <View
            collapsable={false}
            testID={`performance-sheet:${contentProps.performanceSurface ?? "sheet"}`}
            style={[
              styles.content,
              expanded && styles.expandedContent,
              !fitToContents && styles.fixedHostContent,
              contentProps.style,
            ]}
          >
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
        </RNHostView>
      </ModalBottomSheet>
    </Host>
  );
}

/** Also serves as LegendList's scroll host, preserving its ref, events and sheet gesture handoff. */
export function AppSheetScrollView(props: ComponentPropsWithRef<typeof ScrollView>) {
  return <ScrollView {...props} nestedScrollEnabled={props.nestedScrollEnabled ?? true} />;
}

const styles = StyleSheet.create({
  content: {
    width: "100%",
    minWidth: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  expandedContent: {
    flex: 1,
    minHeight: 0,
    paddingBottom: 0,
  },
  fixedHostContent: {
    flexGrow: 1,
    height: 0,
  },
});
