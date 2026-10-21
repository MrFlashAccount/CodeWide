import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, iconSize, radii, spacing, touchTarget, typeScale } from "../theme";
import { AppText } from "./AppText";
import { useAppDialog } from "./AppDialog";
import { composerSlotStyles } from "./composerSlot.styles";
import { ContentMenu } from "./ContentMenu";

const PRESSED_OPACITY = 0.68;
const DETAILS_MAX_WIDTH = 320;

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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const openDetails = useEvent(() => {
    setDetailsOpen(true);
  });
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
    <View style={composerSlotStyles.row} testID="thread-open-elsewhere-notice">
      <Pressable
        accessibilityHint="Shows why sending is off"
        accessibilityLabel="Open in another app"
        accessibilityLiveRegion="polite"
        accessibilityRole="button"
        onPress={openDetails}
        style={({ pressed }) => [composerSlotStyles.pill, pressed && styles.pressed]}
      >
        {/* The pill stretches; the menu anchors to its fixed-size lock and opens above it. */}
        <OpenElsewhereDetails
          onOpenChange={setDetailsOpen}
          onPressAnchor={openDetails}
          open={detailsOpen}
        />
        <AppText numberOfLines={1} shimmering={checking} style={composerSlotStyles.label}>
          Open in another app
        </AppText>
      </Pressable>
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

/** What "open in another app" means and what the bar's two actions do. */
function OpenElsewhereDetails({
  onOpenChange,
  onPressAnchor,
  open,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onPressAnchor: () => void;
  readonly open: boolean;
}): React.JSX.Element {
  const window = useWindowDimensions();
  return (
    <ContentMenu
      align="start"
      onOpenChange={onOpenChange}
      open={open}
      placement="top"
      trigger={
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onPressAnchor}
        >
          <Ionicons color={colors.textMuted} name="lock-closed-outline" size={iconSize.inline} />
        </Pressable>
      }
      width={Math.min(DETAILS_MAX_WIDTH, window.width - spacing.lg)}
    >
      <View style={styles.details} testID="thread-open-elsewhere-details">
        <AppText style={styles.detailsTitle}>Open in another app</AppText>
        <AppText style={styles.detailsBody}>
          Another app on this computer is running this conversation, such as a terminal or a desktop
          app. You can read it here, but sending is off until that app lets go.
        </AppText>
        <DetailsAction icon="refresh" text="Check again to see if it has let go." />
        <DetailsAction icon="git-branch-outline" text="Fork to continue in a new chat now." />
      </View>
    </ContentMenu>
  );
}

function DetailsAction({
  icon,
  text,
}: {
  readonly icon: "refresh" | "git-branch-outline";
  readonly text: string;
}): React.JSX.Element {
  return (
    <View style={styles.detailsAction}>
      <Ionicons color={colors.textMuted} name={icon} size={iconSize.inline} />
      <AppText style={styles.detailsActionText}>{text}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  details: {
    gap: spacing.xs,
    padding: spacing.md,
  },
  detailsAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  detailsActionText: {
    ...typeScale.body,
    color: colors.textMuted,
    flexShrink: 1,
  },
  detailsBody: {
    ...typeScale.body,
    color: colors.text,
    marginBottom: spacing.xxs,
  },
  detailsTitle: {
    ...typeScale.title,
    color: colors.text,
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
  tonal: {
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.border,
    borderWidth: 1,
  },
});
