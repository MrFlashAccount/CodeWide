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
  model,
  resourceId,
  server,
  cwd,
}: {
  model: ThreadHistoryModel | null;
  resourceId: string | null;
  server: ThreadListServer | undefined;
  cwd: string;
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
      testID="conversation-subtitle"
      numberOfLines={1}
      ellipsizeMode="middle"
      style={[styles.conversationSubtitle, { color }]}
    >
      {text}
    </Text>
  );
}

export function ConversationBackendRefreshIndicator({
  model,
  connectionId,
  threadId,
}: {
  model: ThreadChatModel | null;
  connectionId: string | null;
  threadId: string | null;
}) {
  const refreshing = useSelector(() => {
    if (model === null || connectionId === null || threadId === null) return false;
    return model.window$(connectionId, threadId).backendRefreshing.get();
  });
  if (!refreshing) return null;
  return (
    <ActivityIndicator
      testID="conversation-backend-refresh-indicator"
      accessibilityLabel="Updating conversation from server"
      size="small"
      color={colors.amber}
      style={styles.conversationBackendRefreshIndicator}
    />
  );
}

export function ThreadHistoryLoadingIndicator({
  model,
  resourceId,
  hasTimeline,
}: {
  model: ThreadHistoryModel | null;
  resourceId: string | null;
  hasTimeline: boolean;
}) {
  const activity = useThreadHistoryActivity(model, resourceId);
  if (!hasTimeline || activity.status !== "loading-history") return null;
  return (
    <View
      pointerEvents="none"
      testID="history-loading-indicator"
      style={styles.historyLoadingIndicator}
    >
      <View style={styles.historyLoadingIndicatorPill}>
        <ActivityIndicator size="small" color={colors.textMuted} />
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
      {initialLoading ? <ActivityIndicator size="small" color={colors.accent} /> : null}
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
