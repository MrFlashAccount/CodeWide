import type { PropsWithChildren } from "react";
import { View, type ViewProps } from "react-native";

export const KeyboardController = { dismiss: jest.fn(async () => undefined) };
const DEFAULT_KEYBOARD_STATE = {
  appearance: "dark" as const,
  duration: 0,
  height: 0,
  isVisible: false,
  target: 0,
  timestamp: 0,
  type: "default" as const,
};
let keyboardState = DEFAULT_KEYBOARD_STATE;
const keyboardGeometry = {
  height: {
    value: 0,
    set(value: number) {
      this.value = value;
    },
  },
  progress: {
    value: 0,
    set(value: number) {
      this.value = value;
    },
  },
};

export function setKeyboardHeightForTest(height: number): void {
  keyboardState = { ...DEFAULT_KEYBOARD_STATE, height, isVisible: height > 0 };
}

export function useKeyboardState<Value>(
  selector: (state: typeof DEFAULT_KEYBOARD_STATE) => Value,
): Value {
  return selector(keyboardState);
}

export function useKeyboardContext() {
  return { reanimated: keyboardGeometry };
}

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
