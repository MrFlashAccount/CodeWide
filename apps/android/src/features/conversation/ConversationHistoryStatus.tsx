/** V1 ConversationHistoryStatus owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { ActivityIndicator, View } from "react-native";
import type { ThreadChatModel } from "../../data/thread-chat-model";
import type { ThreadHistoryModel } from "../../data/thread-history-model";
import { threadContextLabel } from "../../data/thread-projects";
import { useThreadHistoryActivity } from "../../data/use-thread-history";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import {
  connectionActivity,
  connectionStateLabel,
  type ThreadListServer,
} from "../connections/connectionPresentation";
import { styles } from "./ConversationHistoryStatus.styles";

function connectionWarning(server: ThreadListServer | undefined): string | null {
  if (server?.health === undefined || server.health === "online") {
    return null;
  }
  return connectionStateLabel(server.status, true, server.health);
}

function pendingConnection(server: ThreadListServer | undefined): boolean {
  return server !== undefined && connectionActivity(server.status, server.health) !== null;
}

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
  const text = threadContextLabel(server?.name ?? "", cwd);
  const pending = pendingConnection(server);
  const delayed = activity.status === "background-retrying";
  const color = delayed ? colors.amber : colors.textMuted;
  const warning = pending
    ? null
    : (connectionWarning(server) ?? (delayed ? "update delayed" : null));
  const displayedText = warning === null ? text : `${text} · ${warning}`;
  return (
    <Text
      accessibilityLabel={displayedText}
      ellipsizeMode="middle"
      numberOfLines={1}
      shimmering={pending}
      style={[styles.conversationSubtitle, { color }]}
      testID="conversation-subtitle"
    >
      {displayedText}
    </Text>
  );
}

export function ConversationBackendRefreshWarning({
  connectionId,
  model,
  threadId,
}: {
  connectionId: string | null;
  model: ThreadChatModel | null;
  threadId: string | null;
}) {
  const retrying = useSelector(() => {
    if (model === null || connectionId === null || threadId === null) {
      return false;
    }
    return model.window$(connectionId, threadId).status.get() === "background-retrying";
  });
  if (retrying) {
    return (
      <Ionicons
        accessibilityLabel="Showing cached conversation; update delayed"
        accessibilityRole="image"
        color={colors.amber}
        name="cloud-offline-outline"
        size={iconSize.action}
        testID="conversation-backend-refresh-delayed"
      />
    );
  }
  return null;
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
