import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../theme";

const SKELETON_DELAY_MS = 200;

export type MessageListState =
  | { status: "loading" }
  | { status: "ready" }
  | { message: string; retry: () => Promise<void>; status: "error" };

export type MessageListPresentationState = MessageListState | { status: "positioning" };

interface MessageListBoundaryProps {
  children: ReactNode;
  contentInsets: { readonly bottom: number; readonly top: number };
  loadingKey: string;
  state: MessageListPresentationState;
}

/** Only the transcript waits for history; surrounding controls keep their owners. */
export function MessageListBoundary(props: MessageListBoundaryProps): ReactNode {
  if (props.state.status === "error") {
    return <MessageListError contentInsets={props.contentInsets} state={props.state} />;
  }
  const contentMounted = props.state.status === "positioning" || props.state.status === "ready";
  const contentVisible = props.state.status === "ready";
  return (
    <View style={styles.boundary}>
      <View
        accessibilityElementsHidden={!contentVisible}
        importantForAccessibility={contentVisible ? "auto" : "no-hide-descendants"}
        pointerEvents={contentVisible ? "auto" : "none"}
        style={[styles.contentLayer, !contentVisible && styles.contentLayerHidden]}
        testID="message-list-content-layer"
      >
        {contentMounted ? props.children : null}
      </View>
      {!contentVisible && (
        <MessageListPending contentInsets={props.contentInsets} key={props.loadingKey} />
      )}
    </View>
  );
}

function MessageListPending({ contentInsets }: Pick<MessageListBoundaryProps, "contentInsets">) {
  const [visible, setVisible] = useState(false);
  const reveal = useEvent(() => {
    setVisible(true);
  });
  useEffect(() => {
    // This timer delays presentation only; history loading is already owned by the model.
    const timer = setTimeout(reveal, SKELETON_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [reveal]);
  return (
    <View
      accessibilityLabel={visible ? "Loading messages" : undefined}
      style={styles.pending}
      testID="message-list-pending-overlay"
    >
      {visible ? <MessageListSkeleton contentInsets={contentInsets} /> : null}
    </View>
  );
}

function MessageListSkeleton({ contentInsets }: Pick<MessageListBoundaryProps, "contentInsets">) {
  return (
    <View
      style={[
        styles.content,
        { paddingBottom: contentInsets.bottom, paddingTop: contentInsets.top },
      ]}
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
  contentInsets: MessageListBoundaryProps["contentInsets"];
  state: Extract<MessageListState, { status: "error" }>;
}

function MessageListError(props: MessageListErrorProps) {
  const [pending, startTransition] = useTransition();
  const [retryError, setRetryError] = useState<string | null>(null);
  const retry = useEvent(() => {
    startTransition(async () => {
      try {
        await props.state.retry();
      } catch (error) {
        setRetryError(error instanceof Error ? error.message : "Could not load messages");
      }
    });
  });
  return (
    <View
      style={[
        styles.content,
        { paddingBottom: props.contentInsets.bottom, paddingTop: props.contentInsets.top },
      ]}
      testID="message-list-error"
    >
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
  boundary: {
    backgroundColor: colors.conversationSurface,
    flex: 1,
  },
  content: {
    flex: 1,
    gap: spacing.lg,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.lg,
  },
  contentLayer: {
    flex: 1,
  },
  contentLayerHidden: {
    opacity: 0,
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
  pending: {
    backgroundColor: colors.conversationSurface,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
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
