import { useState, useTransition, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, touchTarget, typeScale } from "../theme";

export type MessageListState =
  | { status: "loading" }
  | { status: "ready" }
  | { message: string; retry: () => Promise<void>; status: "error" };

interface MessageListBoundaryProps {
  children: ReactNode;
  state: MessageListState;
}

/** Only the transcript waits for history; surrounding controls keep their owners. */
export function MessageListBoundary(props: MessageListBoundaryProps): ReactNode {
  if (props.state.status === "ready") {
    return props.children;
  }
  if (props.state.status === "error") {
    return <MessageListError state={props.state} />;
  }
  return <MessageListSkeleton />;
}

export function MessageListSkeleton() {
  return (
    <View
      accessibilityLabel="Loading messages"
      style={styles.content}
      testID="message-list-skeleton"
    >
      <View style={styles.user} />
      <View style={styles.answer}>
        <View style={styles.line} />
        <View style={styles.line} />
        <View style={styles.shortLine} />
      </View>
    </View>
  );
}

interface MessageListErrorProps {
  state: Extract<MessageListState, { status: "error" }>;
}

function MessageListError(props: MessageListErrorProps) {
  const [pending, startTransition] = useTransition();
  const [retryError, setRetryError] = useState<string | null>(null);
  function retry() {
    startTransition(async () => {
      try {
        await props.state.retry();
      } catch (error) {
        setRetryError(error instanceof Error ? error.message : "Could not load messages");
      }
    });
  }
  return (
    <View style={styles.content}>
      <Text accessibilityRole="alert" style={styles.error}>
        {retryError ?? props.state.message}
      </Text>
      <Pressable accessibilityRole="button" disabled={pending} onPress={retry} style={styles.retry}>
        <Text style={styles.label}>Retry loading messages</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  answer: {
    backgroundColor: colors.surface,
    borderRadius: radii.bubble,
    gap: spacing.sm,
    padding: spacing.md,
    width: "88%",
  },
  content: {
    flex: 1,
    gap: spacing.lg,
    justifyContent: "flex-end",
    padding: spacing.lg,
  },
  error: {
    ...typeScale.body,
    color: colors.red,
  },
  label: {
    ...typeScale.body,
    color: colors.text,
  },
  line: {
    backgroundColor: colors.border,
    borderRadius: radii.small,
    height: spacing.sm,
  },
  retry: {
    justifyContent: "center",
    minHeight: touchTarget,
  },
  shortLine: {
    backgroundColor: colors.border,
    borderRadius: radii.small,
    height: spacing.sm,
    width: "60%",
  },
  user: {
    alignSelf: "flex-end",
    backgroundColor: colors.surface,
    borderRadius: radii.bubble,
    height: touchTarget,
    width: "55%",
  },
});
