import { forwardRef, useImperativeHandle, type ReactNode } from "react";
import { View } from "react-native";

interface MockSwipeableMethods {
  close(): void;
}

interface MockSwipeableProps {
  children: ReactNode;
  renderRightActions?(): ReactNode;
}

function MockSwipeable(
  props: MockSwipeableProps,
  ref: React.ForwardedRef<MockSwipeableMethods>,
): React.JSX.Element {
  const { children, renderRightActions } = props;
  useImperativeHandle(ref, () => ({ close: () => undefined }), []);
  return (
    <View>
      {children}
      <View testID="thread-swipe-actions">{renderRightActions?.()}</View>
    </View>
  );
}

export default forwardRef(MockSwipeable);
