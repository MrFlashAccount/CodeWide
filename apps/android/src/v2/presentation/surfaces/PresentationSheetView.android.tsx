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
import { colors, radii, spacing } from "../../theme";

const SHEET_MAX_WIDTH = 580;
const SHEET_FRAME_MAX_WIDTH = SHEET_MAX_WIDTH + spacing.md * 2;

export type PresentationSheetContentProps = Omit<
  BottomSheetProps,
  "children" | "index" | "onChange" | "onClose" | "onDismiss" | "ref"
> & {
  backgroundClassName?: string;
  bottomInset?: number;
  className?: string;
  contentContainerClassName?: string;
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
  const detached = contentProps.detached ?? true;
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
        containerColor={colors.surfaceContainerHigh}
        contentColor={colors.text}
        initialFullyExpanded={initialFullyExpanded}
        onDismissRequest={dismiss}
        properties={{
          shouldDismissOnBackPress: contentProps.enablePanDownToClose ?? true,
          shouldDismissOnClickOutside: contentProps.enablePanDownToClose ?? true,
        }}
        scrimColor={colors.scrim}
        sheetGesturesEnabled={contentProps.enablePanDownToClose ?? true}
        showDragHandle={false}
        skipPartiallyExpanded={fitToContents || !hasMultipleSnapPoints}
      >
        <RNHostView matchContents={fitToContents}>
          <View
            style={[
              styles.frame,
              expanded && styles.expandedFrame,
              !fitToContents && styles.fixedHostContent,
            ]}
          >
            <View style={[styles.inset, expanded && styles.expandedInset]}>
              <View
                style={[
                  styles.surface,
                  detached && styles.detachedSurface,
                  expanded && styles.expandedSurface,
                  contentProps.style,
                ]}
              >
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.handleArea}
                >
                  <View style={styles.handle} />
                </View>
                {children}
              </View>
            </View>
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
  detachedSurface: { borderRadius: 32 },
  expandedFrame: { flex: 1, minHeight: 0 },
  expandedInset: { flex: 1, minHeight: 0 },
  expandedSurface: { flex: 1, minHeight: 0 },
  fixedHostContent: { flexGrow: 1, height: 0 },
  frame: { minWidth: 0, width: "100%" },
  handle: {
    backgroundColor: colors.textDim,
    borderRadius: 2,
    height: 4,
    width: 36,
  },
  handleArea: {
    alignItems: "center",
    flexShrink: 0,
    height: 24,
    justifyContent: "center",
  },
  inset: {
    alignSelf: "center",
    maxWidth: SHEET_FRAME_MAX_WIDTH,
    minWidth: 0,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    width: "100%",
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
