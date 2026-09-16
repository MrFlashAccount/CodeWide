import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors, spacing, typeScale } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

export type SidebarListState =
  | { status: "loading" }
  | { status: "empty" }
  | { message: string; status: "error" };

export function sidebarListState(
  phase: "idle" | "loading" | "ready" | "error" | undefined,
  error: string | null,
  connecting: boolean,
): SidebarListState {
  if (connecting || phase === undefined || phase === "idle" || phase === "loading") {
    return { status: "loading" };
  }
  if (phase === "error") {
    return { message: error ?? "Could not load chats", status: "error" };
  }
  return { status: "empty" };
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
  return (
    <View style={styles.root}>
      {state.status === "loading" ? (
        <ActivityIndicator accessibilityLabel="Loading chats" color={colors.accent} />
      ) : (
        <Text accessibilityRole={state.status === "error" ? "alert" : "text"} style={styles.text}>
          {state.status === "error"
            ? state.message
            : archived
              ? "No archived threads"
              : "No threads found"}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
