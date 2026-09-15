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
  text,
  getText,
  compact = false,
}: {
  text?: string;
  getText?: () => string;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel="Copy"
      hitSlop={controlHitSlop.compact}
      onPress={() => void Clipboard.setStringAsync(getText?.() ?? text ?? "")}
      style={compact ? styles.copyButtonCompact : styles.copyButton}
    >
      <InlineIcon name="copy-outline" role="label" color={colors.textMuted} />
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
      openMessageActions(props.request, { pageX, pageY, width, height });
    });
  };
  return (
    <View style={styles.messageActionRail}>
      <Pressable
        ref={actionButtonRef}
        accessibilityRole="button"
        accessibilityLabel="Message actions"
        collapsable={false}
        hitSlop={controlHitSlop.compact}
        onPress={openActions}
        style={({ pressed }) => [styles.messageActionButton, pressed && styles.pressed]}
      >
        <Ionicons name="ellipsis-vertical" size={iconSize.action} color={colors.textDim} />
      </Pressable>
    </View>
  );
}
