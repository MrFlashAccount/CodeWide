import type { BottomSheetProps } from "@expo/ui/community/bottom-sheet";
import type { ReactNode } from "react";
import type { ScrollViewProps, StyleProp, ViewStyle } from "react-native";

import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";

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
  return (
    <AppSheet contentProps={contentProps} isOpen={isOpen} onOpenChange={onOpenChange}>
      {children}
    </AppSheet>
  );
}

export function PresentationSheetScrollView(props: ScrollViewProps): React.JSX.Element {
  return <AppSheetScrollView {...props} />;
}
