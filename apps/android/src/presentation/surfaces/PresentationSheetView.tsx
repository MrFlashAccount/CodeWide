import {
  BottomSheet,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetProps,
} from "@expo/ui/community/bottom-sheet";
import type { ReactNode } from "react";
import {
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useEvent } from "../../react/useEvent";
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

export function PresentationSheetView(props: PresentationSheetViewProps): React.JSX.Element {
  const { children, contentProps, isOpen, onOpenChange } = props;
  const expanded = contentProps.enableDynamicSizing === false;
  const detached = contentProps.detached ?? true;
  const close = useEvent(() => onOpenChange(false));

  return (
    <BottomSheet
      backgroundStyle={styles.sheetBackground}
      enableDynamicSizing={contentProps.enableDynamicSizing ?? true}
      enablePanDownToClose={contentProps.enablePanDownToClose ?? true}
      handleComponent={null}
      index={isOpen ? (contentProps.index ?? 0) : -1}
      onClose={close}
      {...(contentProps.enableOverDrag === undefined
        ? {}
        : { enableOverDrag: contentProps.enableOverDrag })}
      {...(contentProps.snapPoints === undefined ? {} : { snapPoints: contentProps.snapPoints })}
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
      </BottomSheetView>
    </BottomSheet>
  );
}

export function PresentationSheetScrollView(scrollViewProps: ScrollViewProps): React.JSX.Element {
  const { nestedScrollEnabled = true, ...props } = scrollViewProps;
  return <BottomSheetScrollView nestedScrollEnabled={nestedScrollEnabled} {...props} />;
}

const styles = StyleSheet.create({
  detachedSurface: { borderRadius: 32 },
  expandedFrame: { flex: 1, minHeight: 0 },
  expandedInset: { flex: 1, minHeight: 0 },
  expandedSurface: { flex: 1, minHeight: 0 },
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
  sheetBackground: { backgroundColor: colors.surfaceContainerHigh },
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
