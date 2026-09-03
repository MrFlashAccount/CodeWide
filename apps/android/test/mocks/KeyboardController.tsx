import type { PropsWithChildren } from "react";
import { View, type ViewProps } from "react-native";

interface KeyboardStickyViewProps extends ViewProps {
  enabled?: boolean;
  offset?: { closed?: number; opened?: number };
}

export function KeyboardStickyView(props: PropsWithChildren<KeyboardStickyViewProps>) {
  const { children, enabled, offset, ...viewProps } = props;
  const renderedProps = {
    ...viewProps,
    enabled,
    offset,
    testID: viewProps.testID ?? "keyboard-sticky-view",
  } as ViewProps;
  return <View {...renderedProps}>{children}</View>;
}
