import { useRef } from "react";
import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, typeScale } from "../../theme";
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
          hitSlop={6}
          onPress={openActions}
          style={messageActionStyle}
        >
          <View style={styles.actionIcon}>
            <PresentationIcon color={colors.textDim} name="more" size={18} />
          </View>
        </Pressable>
      )}
      {completedAt === null ? null : (
        <ProductText style={styles.time} tone="dim">
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
    borderRadius: 16,
    flexShrink: 0,
    height: 32,
    justifyContent: "center",
    marginLeft: -spacing.xxs,
    width: 32,
  },
  actionIcon: { transform: [{ translateX: 2 }] },
  pressed: { opacity: 0.68 },
  rail: {
    alignItems: "flex-start",
    alignSelf: "stretch",
    flexShrink: 0,
    justifyContent: "space-between",
    marginLeft: -spacing.sm,
    minHeight: 32,
    paddingBottom: spacing.xxs,
    width: 40,
  },
  time: {
    ...typeScale.caption,
    fontVariant: ["tabular-nums"],

    marginLeft: spacing.sm,
  },
});
