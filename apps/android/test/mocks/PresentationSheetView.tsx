import type { PropsWithChildren } from "react";
import { Pressable, ScrollView, View, type ScrollViewProps } from "react-native";

interface PresentationSheetViewProps extends PropsWithChildren {
  isOpen: boolean;
  contentProps?: { dismissLabel?: string; enablePanDownToClose?: boolean };
  onOpenChange?(open: boolean): void;
}

export function PresentationSheetView({
  children,
  isOpen,
  contentProps,
  onOpenChange,
}: PresentationSheetViewProps): React.JSX.Element | null {
  return isOpen ? <View>
    <Pressable accessibilityRole="button" accessibilityLabel={contentProps?.dismissLabel ?? "Dismiss sheet"}
      disabled={contentProps?.enablePanDownToClose === false} onPress={() => onOpenChange?.(false)} />
    {children}
  </View> : null;
}

export function PresentationSheetScrollView(props: ScrollViewProps): React.JSX.Element {
  return <ScrollView {...props} />;
}
