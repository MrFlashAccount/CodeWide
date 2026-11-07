import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useEvent } from "../../react/useEvent";
import { colors, controlSize, radii, spacing, typeScale } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { ThreadListSkeleton } from "./ThreadListBoundary";

export type SidebarListState =
  | { status: "loading" }
  | { status: "empty" }
  | { message: string; status: "error" };

export function sidebarListState(
  phase: "idle" | "loading" | "ready" | "error" | undefined,
  error: string | null,
): SidebarListState {
  if (phase === "error") {
    return { message: error ?? "Could not load chats", status: "error" };
  }
  return { status: phase === "ready" ? "empty" : "loading" };
}

/** Mount only without rows. Fast reads remain blank; loading never masquerades as an empty result. */
export function SidebarListFeedback({
  archived,
  state,
}: {
  archived: boolean;
  state: SidebarListState;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(true);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  if (!visible) {
    return null;
  }
  if (state.status === "loading") {
    return <ThreadListSkeleton />;
  }
  return (
    <View style={styles.root}>
      <Text accessibilityRole={state.status === "error" ? "alert" : "text"} style={styles.text}>
        {state.status === "error"
          ? state.message
          : archived
            ? "No archived threads"
            : "No threads found"}
      </Text>
    </View>
  );
}

/** Keeps a failed continuation visible without replacing already loaded rows. */
export function ThreadListPageError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}): ReactElement {
  const retry = useEvent(onRetry);
  return (
    <View style={styles.pageError} testID="thread-list-page-error">
      <Text accessibilityRole="alert" style={styles.errorText}>
        {message}
      </Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.retryButton}>
        <Text style={styles.retryLabel}>Retry loading chats</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  errorText: {
    color: colors.red,
    ...typeScale.label,
    textAlign: "center",
  },
  pageError: {
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.md,
  },
  retryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  retryLabel: {
    color: colors.text,
    ...typeScale.label,
  },
  root: {
    alignItems: "center",
    padding: spacing.lg,
  },
  text: {
    color: colors.textMuted,
    ...typeScale.body,
    textAlign: "center",
  },
});
