import type { BottomSheetProps } from "@expo/ui/community/bottom-sheet";
import {
  Host,
  ModalBottomSheet,
  RNHostView,
  type ModalBottomSheetRef,
} from "@expo/ui/jetpack-compose";
import { width as composeWidth } from "@expo/ui/jetpack-compose/modifiers";
import { useEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useEvent } from "../react/useEvent";
import { spacing } from "../theme";
import type { SheetPerformanceSurface } from "../presentation/diagnostics/sheetPerformanceSurface";
import { OverlaySurfaceProvider } from "./OverlaySurfaceContext";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";
import { SheetBackProvider, useSheetDismissController } from "./sheetNavigation";

// Material's standard sheet width. Both layout trees must receive the same
// constraint: RNHostView(matchContents) otherwise forces window-wide Yoga
// content into the narrower Material surface on tablets and unfolded devices.
const SHEET_MAX_WIDTH = 640;

type AppSheetContentProps = Omit<
  BottomSheetProps,
  "children" | "index" | "onChange" | "onClose" | "onDismiss" | "ref"
> & {
  backgroundClassName?: string;
  bottomInset?: number;
  className?: string;
  contentContainerClassName?: string;
  detached?: boolean;
  /** Non-Android compatibility; Material owns the native handle semantics. */
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
  const { width: windowWidth } = useWindowDimensions();
  const width = Math.min(windowWidth, SHEET_MAX_WIDTH);
  const sheetRef = useRef<ModalBottomSheetRef>(null);
  const [nativeSheetReady, setNativeSheetReady] = useState(false);
  const closeSheet = useEvent(() => {
    onOpenChange(false);
  });
  const dismiss = useSheetDismissController(closeSheet, onDismissRequest);
  const expanded = contentProps.enableDynamicSizing === false;
  const fitToContents =
    contentProps.enableDynamicSizing !== false &&
    (contentProps.snapPoints === undefined || contentProps.snapPoints.length === 0);
  const hasMultipleSnapPoints = (contentProps.snapPoints?.length ?? 0) > 1;
  const maxIndex = Math.max(0, (contentProps.snapPoints?.length ?? 1) - 1);
  const initialFullyExpanded = hasMultipleSnapPoints && (contentProps.index ?? 0) === maxIndex;
  const setSheetRef = useEvent((sheet: ModalBottomSheetRef | null) => {
    sheetRef.current = sheet;
    if (sheet !== null) {
      setNativeSheetReady(true);
    }
  });
  useEffect(() => {
    if (isOpen || !nativeSheetReady) {
      return undefined;
    }

    let cancelled = false;
    const hide = sheetRef.current?.hide();
    if (hide === undefined) {
      return undefined;
    }
    hide.then(
      () => {
        if (!cancelled) {
          setNativeSheetReady(false);
        }
      },
      () => {
        if (!cancelled) {
          setNativeSheetReady(false);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [isOpen, nativeSheetReady]);

  if (!isOpen && !nativeSheetReady) {
    return null;
  }

  return (
    <Host colorScheme="dark" pointerEvents="none" style={{ position: "absolute", width }}>
      <ModalBottomSheet
        initialFullyExpanded={initialFullyExpanded}
        modifiers={[composeWidth(width)]}
        {...(isOpen && dismiss.canGoBack ? { onBackPress: dismiss.requestDismiss } : {})}
        onDismissRequest={closeSheet}
        properties={{
          shouldDismissOnBackPress: contentProps.enablePanDownToClose ?? true,
          shouldDismissOnClickOutside: contentProps.enablePanDownToClose ?? true,
        }}
        ref={setSheetRef}
        sheetGesturesEnabled={contentProps.enablePanDownToClose ?? true}
        showDragHandle={contentProps.enablePanDownToClose ?? true}
        skipPartiallyExpanded={fitToContents || !hasMultipleSnapPoints}
      >
        <RNHostView matchContents={fitToContents}>
          <View
            style={[
              styles.content,
              expanded && styles.expandedContent,
              !fitToContents && styles.fixedHostContent,
              contentProps.style,
            ]}
            testID={`performance-sheet:${contentProps.performanceSurface ?? "sheet"}`}
          >
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
    alignSelf: "stretch",
    minWidth: 0,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
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
