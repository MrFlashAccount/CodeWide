import { useCallback } from "react";
import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";

interface ThreadSwipeActionsProps {
  archived: boolean;
  pending: boolean;
  pinned: boolean;
  remoteDisabled: boolean;
  unread: boolean;
  onArchive(): void;
  onMarkRead(): void;
  onTogglePin(): void;
}

interface ThreadSwipeActionProps {
  disabled: boolean;
  icon: "archive" | "checkCircle" | "pin";
  label: string;
  onPress(): void;
  tone: "accent" | "danger" | "neutral";
}

export function ThreadSwipeActions(props: ThreadSwipeActionsProps): React.JSX.Element {
  const { archived, onArchive, onMarkRead, onTogglePin, pending, pinned, remoteDisabled, unread } =
    props;
  return (
    <View style={styles.actions}>
      <ThreadSwipeAction
        disabled={pending}
        icon="pin"
        label={pinned ? "Unpin" : "Pin"}
        onPress={onTogglePin}
        tone="neutral"
      />
      <ThreadSwipeAction
        disabled={pending || remoteDisabled || !unread}
        icon="checkCircle"
        label="Read"
        onPress={onMarkRead}
        tone="accent"
      />
      <ThreadSwipeAction
        disabled={pending || remoteDisabled}
        icon="archive"
        label={archived ? "Unarchive" : "Archive"}
        onPress={onArchive}
        tone={archived ? "accent" : "danger"}
      />
    </View>
  );
}

function ThreadSwipeAction(props: ThreadSwipeActionProps): React.JSX.Element {
  const { disabled, icon, label, onPress, tone } = props;
  const foreground = tone === "danger" ? colors.onErrorContainer : colors.text;
  // Pressable invokes the style callback during render, so useEvent cannot safely own it.
  // oxlint-disable-next-line react-doctor/react-compiler-no-manual-memoization
  const style = useCallback(
    (state: PressableStateCallbackType) => swipeActionStyle(state, tone),
    [tone],
  );
  return (
    <Pressable
      accessibilityLabel={`${label} thread`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={style}
    >
      <PresentationIcon color={foreground} name={icon} size={19} />
      <ProductText style={[styles.label, { color: foreground }]}>{label}</ProductText>
    </Pressable>
  );
}

function swipeActionStyle(state: PressableStateCallbackType, tone: ThreadSwipeActionProps["tone"]) {
  const { pressed } = state;
  return [
    styles.action,
    tone === "neutral" && styles.neutral,
    tone === "accent" && styles.accent,
    tone === "danger" && styles.danger,
    pressed && styles.pressed,
  ];
}

const styles = StyleSheet.create({
  accent: { backgroundColor: colors.primary },
  action: { alignItems: "center", gap: spacing.xxs, justifyContent: "center", width: 72 },
  actions: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainerHigh,
    flexDirection: "row",
  },
  danger: { backgroundColor: colors.errorContainer },
  label: { ...typeScale.caption },
  neutral: { backgroundColor: colors.surfaceContainerHigh },
  pressed: { opacity: 0.72 },
});
