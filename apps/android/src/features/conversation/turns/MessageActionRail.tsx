/** V1 MessageActionRail owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useRef } from "react";
import { Pressable, View } from "react-native";
import { colors, controlHitSlop, iconSize } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { useMessageActionMenu } from "../../../ui/MessageActionMenu";
import type { MessageActionMenuRequest } from "../../../ui/MessageActionMenu.types";
import { styles } from "./MessageActionRail.styles";

export function CopyButton({
  compact = false,
  getText,
  text,
}: {
  compact?: boolean;
  getText?: () => string;
  text?: string;
}) {
  return (
    <Pressable
      accessibilityLabel="Copy"
      hitSlop={controlHitSlop.compact}
      onPress={() => void Clipboard.setStringAsync(getText?.() ?? text ?? "")}
      style={compact ? styles.copyButtonCompact : styles.copyButton}
    >
      <InlineIcon color={colors.textMuted} name="copy-outline" role="label" />
    </Pressable>
  );
}

export interface MessageActionRailProps {
  readonly request: MessageActionMenuRequest;
}

export function MessageActionRail(props: MessageActionRailProps) {
  const openMessageActions = useMessageActionMenu();
  const actionButtonRef = useRef<View>(null);
  const openActions = () => {
    actionButtonRef.current?.measureInWindow((pageX, pageY, width, height) => {
      openMessageActions(props.request, { height, pageX, pageY, width });
    });
  };
  return (
    <View style={styles.messageActionRail}>
      <Pressable
        accessibilityLabel="Message actions"
        accessibilityRole="button"
        collapsable={false}
        hitSlop={controlHitSlop.compact}
        onPress={openActions}
        ref={actionButtonRef}
        style={({ pressed }) => [styles.messageActionButton, pressed && styles.pressed]}
      >
        <Ionicons color={colors.textDim} name="ellipsis-vertical" size={iconSize.action} />
      </Pressable>
    </View>
  );
}
