import type { PropsWithChildren } from "react";
import { View, type ViewProps } from "react-native";

export const KeyboardController = { dismiss: jest.fn(async () => undefined) };

interface KeyboardStickyViewProps extends ViewProps {
  enabled?: boolean;
  offset?: { closed?: number; opened?: number };
}

interface KeyboardGestureAreaProps extends ViewProps {
  enableSwipeToDismiss?: boolean;
  interpolator?: string;
  offset?: number;
}

export function KeyboardGestureArea(props: PropsWithChildren<KeyboardGestureAreaProps>) {
  const { children, enableSwipeToDismiss, interpolator, offset, ...viewProps } = props;
  return (
    <View
      {...viewProps}
      enableSwipeToDismiss={enableSwipeToDismiss}
      interpolator={interpolator}
      offset={offset}
      testID={viewProps.testID ?? "keyboard-gesture-area"}
    >
      {children}
    </View>
  );
}

export function KeyboardStickyView(props: PropsWithChildren<KeyboardStickyViewProps>) {
  const { children, enabled, offset, ...viewProps } = props;
  const renderedProps = {
    ...viewProps,
    enabled,
    offset,
    testID: viewProps.testID ?? "keyboard-sticky-view",
  };
  return <View {...renderedProps}>{children}</View>;
}
