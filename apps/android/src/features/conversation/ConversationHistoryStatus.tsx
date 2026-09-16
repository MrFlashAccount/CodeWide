/** V1 ConversationHistoryStatus owner, extracted without changing interaction or resource lifetime. */
import { useSelector } from "@legendapp/state/react";
import { ActivityIndicator, View } from "react-native";
import type { ThreadChatModel } from "../../data/thread-chat-model";
import type { ThreadHistoryModel } from "../../data/thread-history-model";
import { threadContextLabel } from "../../data/thread-projects";
import { useThreadHistoryActivity } from "../../data/use-thread-history";
import { colors } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import {
  connectionActivityColor,
  type ThreadListServer,
} from "../connections/connectionPresentation";
import { styles } from "./ConversationHistoryStatus.styles";

export function ConversationHistorySubtitle({
  cwd,
  model,
  resourceId,
  server,
}: {
  cwd: string;
  model: ThreadHistoryModel | null;
  resourceId: string | null;
  server: ThreadListServer | undefined;
}) {
  const activity = useThreadHistoryActivity(model, resourceId);
  const connecting = server?.status === "connecting";
  const text = connecting
    ? "connecting…"
    : activity.status === "background-retrying"
      ? "update delayed"
      : threadContextLabel(server?.name ?? "", cwd);
  const color = connecting
    ? connectionActivityColor("connecting")
    : activity.status === "background-retrying"
      ? colors.amber
      : colors.textMuted;
  return (
    <Text
      ellipsizeMode="middle"
      numberOfLines={1}
      style={[styles.conversationSubtitle, { color }]}
      testID="conversation-subtitle"
    >
      {text}
    </Text>
  );
}

export function ConversationBackendRefreshIndicator({
  connectionId,
  model,
  threadId,
}: {
  connectionId: string | null;
  model: ThreadChatModel | null;
  threadId: string | null;
}) {
  const refreshing = useSelector(() => {
    if (model === null || connectionId === null || threadId === null) {
      return false;
    }
    return model.window$(connectionId, threadId).backendRefreshing.get();
  });
  if (!refreshing) {
    return null;
  }
  return (
    <ActivityIndicator
      accessibilityLabel="Updating conversation from server"
      color={colors.amber}
      size="small"
      style={styles.conversationBackendRefreshIndicator}
      testID="conversation-backend-refresh-indicator"
    />
  );
}

export function ThreadHistoryLoadingIndicator({
  hasTimeline,
  model,
  resourceId,
}: {
  hasTimeline: boolean;
  model: ThreadHistoryModel | null;
  resourceId: string | null;
}) {
  const activity = useThreadHistoryActivity(model, resourceId);
  if (!hasTimeline || activity.status !== "loading-history") {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      style={styles.historyLoadingIndicator}
      testID="history-loading-indicator"
    >
      <View style={styles.historyLoadingIndicatorPill}>
        <ActivityIndicator color={colors.textMuted} size="small" />
      </View>
    </View>
  );
}

export function ThreadHistoryEmptyState({
  model,
  resourceId,
  threadSearchActive,
}: {
  model: ThreadHistoryModel | null;
  resourceId: string | null;
  threadSearchActive: boolean;
}) {
  const activity = useThreadHistoryActivity(model, resourceId);
  const initialLoading = !threadSearchActive && activity.status === "initial-loading";
  return (
    <>
      {initialLoading ? <ActivityIndicator color={colors.accent} size="small" /> : null}
      <Text style={styles.emptyText}>
        {threadSearchActive
          ? "No matches"
          : activity.status === "initial-error"
            ? (activity.error ?? "Could not load messages")
            : initialLoading
              ? "Loading messages…"
              : "Start by typing a message"}
      </Text>
    </>
  );
}
