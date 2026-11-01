/** V1 MessageActionRail owner, extracted without changing interaction or resource lifetime. */
import * as Clipboard from "expo-clipboard";
import { useRef } from "react";
import { Pressable, View } from "react-native";
import { colors, controlHitSlop } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { useMessageActionMenu } from "../../../ui/MessageActionMenu";
import type { MessageActionMenuRequest } from "../../../ui/MessageActionMenu.types";
import { OverflowMenuButton } from "../../../ui/OverflowMenuButton";
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
      <OverflowMenuButton
        accessibilityLabel="Message actions"
        onPress={openActions}
        ref={actionButtonRef}
        size="compact"
        style={styles.messageActionButton}
        tone="dim"
      />
    </View>
  );
}
