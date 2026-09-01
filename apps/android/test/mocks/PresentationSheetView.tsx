import type { PropsWithChildren } from "react";
import { ScrollView, View, type ScrollViewProps } from "react-native";

interface PresentationSheetViewProps extends PropsWithChildren {
  isOpen: boolean;
}

export function PresentationSheetView({
  children,
  isOpen,
}: PresentationSheetViewProps): React.JSX.Element | null {
  return isOpen ? <View>{children}</View> : null;
}

export function PresentationSheetScrollView(props: ScrollViewProps): React.JSX.Element {
  return <ScrollView {...props} />;
}
