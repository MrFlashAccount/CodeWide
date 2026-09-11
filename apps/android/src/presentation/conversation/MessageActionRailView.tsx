import { useRef } from "react";
import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import {
  colors,
  controlSize,
  controlHitSlop,
  iconSize,
  radii,
  spacing,
  typeScale,
} from "../../theme";
import { useMessageActionMenu } from "../../ui/MessageActionMenu";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";

interface MessageActionRailViewProps {
  completedAt: string | null;
  copyText: string;
}

export function MessageActionRailView(props: MessageActionRailViewProps): React.JSX.Element {
  const { completedAt, copyText } = props;
  const openMessageActions = useMessageActionMenu();
  const actionButtonRef = useRef<View>(null);
  const openActions = useEvent(() => {
    actionButtonRef.current?.measureInWindow((pageX, pageY, width, height) => {
      openMessageActions({ copyText }, { height, pageX, pageY, width });
    });
  });

  return (
    <View style={styles.rail}>
      {copyText === "" ? null : (
        <Pressable
          ref={actionButtonRef}
          accessibilityLabel="Message actions"
          accessibilityRole="button"
          collapsable={false}
          hitSlop={controlHitSlop.compact}
          onPress={openActions}
          style={messageActionStyle}
        >
          <PresentationIcon color={colors.textDim} name="more" size={iconSize.action} />
        </Pressable>
      )}
      {completedAt === null ? null : (
        <ProductText numberOfLines={1} style={styles.time} tone="dim">
          {completedAt}
        </ProductText>
      )}
    </View>
  );
}

function messageActionStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.action, pressed ? styles.pressed : null];
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexShrink: 0,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  pressed: { opacity: 0.68 },
  rail: {
    alignItems: "center",
    alignSelf: "stretch",
    flexShrink: 0,
    justifyContent: "space-between",
    minHeight: controlSize.compact,
    paddingBottom: spacing.xxs,
    minWidth: controlSize.regular,
  },
  time: {
    ...typeScale.caption,
    fontVariant: ["tabular-nums"],
  },
});
