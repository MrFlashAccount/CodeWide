import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, iconSize, radii, spacing, touchTarget, typeScale } from "../theme";
import { AppText } from "./AppText";
import { useAppDialog } from "./AppDialog";
import {
  conversationChromeEdgeInset,
  conversationComposerDockMinHeight,
} from "./conversation-chrome-layout";

const PRESSED_OPACITY = 0.68;

/**
 * Persistent state of a conversation another app is running. It takes the
 * composer's row and shape: the lock where the editor is, then Fork and the
 * primary Check again where the composer's actions are.
 */
export function ThreadOpenElsewhereNotice({
  onCheckAgain,
  onFork,
}: {
  /** Re-reads the thread: it opens for input once the other app has let go. */
  readonly onCheckAgain: () => Promise<void>;
  /** Opens the fork sheet for the whole chat; `null` when the thread offers no fork. */
  readonly onFork: (() => void) | null;
}): React.JSX.Element {
  const dialog = useAppDialog();
  const [checking, setChecking] = useState(false);
  const checkAgain = useEvent(() => {
    setChecking(true);
    onCheckAgain().then(
      () => {
        setChecking(false);
      },
      (error: unknown) => {
        setChecking(false);
        dialog.alert(
          "Couldn't check the conversation",
          error instanceof Error ? error.message : "The conversation could not be read.",
        );
      },
    );
  });
  return (
    <View style={styles.row} testID="thread-open-elsewhere-notice">
      <View
        accessibilityLabel="Open in another app. Another app is running this conversation."
        accessibilityLiveRegion="polite"
        accessible
        style={styles.pill}
      >
        <Ionicons color={colors.textMuted} name="lock-closed-outline" size={iconSize.inline} />
        <AppText numberOfLines={1} shimmering={checking} style={styles.label}>
          Open in another app
        </AppText>
      </View>
      {onFork !== null && (
        <Pressable
          accessibilityLabel="Fork chat"
          accessibilityRole="button"
          onPress={onFork}
          style={({ pressed }) => [styles.round, styles.tonal, pressed && styles.pressed]}
        >
          <Ionicons color={colors.text} name="git-branch-outline" size={iconSize.action} />
        </Pressable>
      )}
      <Pressable
        accessibilityLabel="Check again"
        accessibilityRole="button"
        accessibilityState={{ busy: checking, disabled: checking }}
        disabled={checking}
        onPress={checkAgain}
        style={({ pressed }) => [styles.round, styles.primary, pressed && styles.primaryPressed]}
      >
        <Ionicons color={colors.onPrimary} name="refresh" size={iconSize.action} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typeScale.composerInput,
    color: colors.text,
    flexShrink: 1,
  },
  pill: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.border,
    borderRadius: radii.composer,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    height: touchTarget,
    minWidth: 0,
    paddingHorizontal: spacing.md,
  },
  pressed: { opacity: PRESSED_OPACITY },
  primary: { backgroundColor: colors.accent },
  primaryPressed: { backgroundColor: colors.accentPressed },
  round: {
    alignItems: "center",
    borderRadius: radii.composer,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  // The composer's row: same insets and height, so taking its place moves nothing.
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: conversationComposerDockMinHeight,
    paddingBottom: spacing.compact,
    paddingHorizontal: conversationChromeEdgeInset,
    paddingTop: spacing.xxs,
  },
  tonal: {
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.border,
    borderWidth: 1,
  },
});
