import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { Pressable, StyleSheet, View } from "react-native";

import type { ThreadUnreadReader } from "../../data/project-unread-model";
import type { ThreadId } from "../../data/reviewContract";
import { colors, controlSize, iconSize, radii } from "../../theme";

/**
 * Opens the PR's canonical ordinary conversation; the route owns its panel.
 * The screen places it among its floating actions.
 * A dot marks agent replies the user has not read in that chat yet.
 */
export function LinkedChatButton({
  disabled,
  isThreadUnread,
  label,
  onPress,
  reviewThreadId,
}: {
  readonly disabled: boolean;
  readonly isThreadUnread: ThreadUnreadReader;
  readonly label: string;
  readonly onPress: () => void;
  readonly reviewThreadId: ThreadId | null;
}): React.JSX.Element {
  const unread = useSelector(() => reviewThreadId !== null && isThreadUnread(reviewThreadId));
  return (
    <Pressable
      accessibilityLabel={unread ? `${label}, new agent reply` : label}
      accessibilityRole="button"
      accessibilityState={{ busy: disabled, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.chatButton, (disabled || pressed) && styles.chatButtonMuted]}
      testID="pull-request-linked-chat"
    >
      <Ionicons color={colors.onPrimary} name="chatbubble-outline" size={iconSize.navigation} />
      {unread ? <View style={styles.unreadBadge} testID="pull-request-linked-chat-unread" /> : null}
    </Pressable>
  );
}

const MUTED_CONTROL_OPACITY = 0.6;
/** The catalog unread dot, enlarged for the button and ringed by the screen surface. */
const UNREAD_BADGE_SIZE = 12;
const UNREAD_BADGE_RING = 2;

const styles = StyleSheet.create({
  chatButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  chatButtonMuted: {
    opacity: MUTED_CONTROL_OPACITY,
  },
  unreadBadge: {
    backgroundColor: colors.primary,
    borderColor: colors.conversationSurface,
    borderRadius: radii.pill,
    borderWidth: UNREAD_BADGE_RING,
    height: UNREAD_BADGE_SIZE,
    position: "absolute",
    right: 0,
    top: 0,
    width: UNREAD_BADGE_SIZE,
  },
});
