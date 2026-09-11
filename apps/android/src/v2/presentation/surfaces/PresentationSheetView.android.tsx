import type { BottomSheetProps } from "@expo/ui/community/bottom-sheet";
import { Host, ModalBottomSheet, RNHostView } from "@expo/ui/jetpack-compose";
import type { ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useEvent } from "../../../react/useEvent";
import type { SheetPerformanceSurface } from "../../../presentation/diagnostics/sheetPerformanceSurface";
import { spacing } from "../../theme";

export type PresentationSheetContentProps = Omit<
  BottomSheetProps,
  "children" | "index" | "onChange" | "onClose" | "onDismiss" | "ref"
> & {
  backgroundClassName?: string;
  performanceSurface?: SheetPerformanceSurface;
  bottomInset?: number;
  className?: string;
  contentContainerClassName?: string;
  /** Non-Android compatibility; Material owns the native handle semantics. */
  dismissLabel?: string;
  detached?: boolean;
  index?: number;
  maxDynamicContentSize?: number;
  style?: StyleProp<ViewStyle>;
  topInset?: number;
};

interface PresentationSheetViewProps {
  children: ReactNode;
  contentProps: PresentationSheetContentProps;
  isOpen: boolean;
  onOpenChange(isOpen: boolean): void;
}

export function PresentationSheetView(props: PresentationSheetViewProps): React.JSX.Element | null {
  const { children, contentProps, isOpen, onOpenChange } = props;
  const { width } = useWindowDimensions();
  const expanded = contentProps.enableDynamicSizing === false;
  const fitToContents =
    contentProps.enableDynamicSizing !== false &&
    (contentProps.snapPoints === undefined || contentProps.snapPoints.length === 0);
  const hasMultipleSnapPoints = (contentProps.snapPoints?.length ?? 0) > 1;
  const maxIndex = Math.max(0, (contentProps.snapPoints?.length ?? 1) - 1);
  const initialFullyExpanded = hasMultipleSnapPoints && (contentProps.index ?? 0) === maxIndex;
  const dismiss = useEvent(() => onOpenChange(false));

  if (!isOpen) return null;

  return (
    <Host colorScheme="dark" pointerEvents="none" style={{ position: "absolute", width }}>
      <ModalBottomSheet
        initialFullyExpanded={initialFullyExpanded}
        onDismissRequest={dismiss}
        properties={{
          shouldDismissOnBackPress: contentProps.enablePanDownToClose ?? true,
          shouldDismissOnClickOutside: contentProps.enablePanDownToClose ?? true,
        }}
        sheetGesturesEnabled={contentProps.enablePanDownToClose ?? true}
        showDragHandle={contentProps.enablePanDownToClose ?? true}
        skipPartiallyExpanded={fitToContents || !hasMultipleSnapPoints}
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
            {children}
          </View>
        </RNHostView>
      </ModalBottomSheet>
    </Host>
  );
}

export function PresentationSheetScrollView(props: ScrollViewProps): React.JSX.Element {
  const { nestedScrollEnabled = true, ...scrollViewProps } = props;
  return <ScrollView nestedScrollEnabled={nestedScrollEnabled} {...scrollViewProps} />;
}

const styles = StyleSheet.create({
  expandedContent: { flex: 1, minHeight: 0, paddingBottom: 0 },
  fixedHostContent: { flexGrow: 1, height: 0 },
  content: {
    minWidth: 0,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
});
