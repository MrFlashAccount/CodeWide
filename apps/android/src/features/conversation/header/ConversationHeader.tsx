import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { contextUsageFromProjection } from "../../../data/account-rate-limits";
import { colors, iconSize } from "../../../theme";
import { InlineEmoji } from "../../../ui/InlineIcon";
import { leadingEmoji } from "../../../ui/ThreadTitle";
import { AppText as Text } from "../../../ui/Typography";
import { ContextRing } from "../../accounts/UsagePopover";
import { WorkspaceAccountUsagePopover } from "../../accounts/WorkspaceAccountUsagePopover";
import { ThreadHeaderMenu } from "../../turnActions/ThreadActions";
import {
  ConversationBackendRefreshIndicator,
  ConversationHistorySubtitle,
} from "../ConversationHistoryStatus";
import { styles } from "./ConversationHeader.styles";
import type { ConversationHeaderProps } from "./ConversationHeaderContract";

export function ConversationHeader({
  compact,
  onBack,
  thread,
  threadChatModel,
  draftConnectionId,
  draftThreadId,
  historyActivityModel,
  historyActivityResourceId,
  server,
  cwd,
  newChat,
  threadSearchVisible,
  closeThreadSearch,
  setThreadSearchVisible,
  remoteThread,
  currentUsage,
  sessionCompactionCount,
  accountRateLimitsDatabase,
  onRefreshAccountRateLimits,
  readOnly,
  archived,
  pinned,
  dismissComposerKeyboardForOverlay,
  openThreadRename,
  onTogglePin,
  onUnarchive,
  onArchive,
  onCompact,
  onFork,
  deleteThread,
}: ConversationHeaderProps) {
  return (
    <View testID="conversation-header" style={styles.conversationHeader}>
      {compact && (
        <Pressable onPress={onBack} style={styles.headerIcon} accessibilityLabel="Back to threads">
          <Ionicons name="arrow-back" size={iconSize.navigation} color={colors.text} />
        </Pressable>
      )}
      <View style={[styles.conversationIdentity, !compact && styles.conversationIdentityRaised]}>
        <View style={styles.conversationTitleRow}>
          {leadingEmoji(thread.title) !== null && (
            <InlineEmoji value={leadingEmoji(thread.title) ?? ""} role="title" />
          )}
          <Text
            testID="conversation-title"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.conversationTitle, styles.conversationHeaderTitle]}
          >
            {thread.title.slice(leadingEmoji(thread.title)?.length ?? 0).trimStart()}
          </Text>
          <ConversationBackendRefreshIndicator
            model={threadChatModel}
            connectionId={draftConnectionId}
            threadId={draftThreadId}
          />
        </View>
        <ConversationHistorySubtitle
          model={historyActivityModel}
          resourceId={historyActivityResourceId}
          server={server}
          cwd={cwd}
        />
      </View>
      {!newChat && (
        <Pressable
          onPress={() => {
            if (threadSearchVisible) closeThreadSearch();
            else setThreadSearchVisible(true);
          }}
          style={styles.headerIcon}
          accessibilityLabel="Search in thread"
        >
          <Ionicons name="search" size={iconSize.action} color={colors.text} />
        </Pressable>
      )}
      {!newChat && (
        <WorkspaceAccountUsagePopover
          thread={remoteThread ?? null}
          currentUsage={currentUsage}
          compactionCount={sessionCompactionCount}
          database={accountRateLimitsDatabase}
          servers={[
            {
              id: server?.id ?? "active-server",
              name: server?.name ?? "Server",
            },
          ]}
          placement="bottom"
          align="end"
          {...(onRefreshAccountRateLimits === undefined
            ? {}
            : { onRefresh: onRefreshAccountRateLimits })}
        >
          <Pressable
            accessibilityLabel="Context usage and account limits"
            style={styles.headerIcon}
          >
            <ContextRing
              percent={contextUsageFromProjection(currentUsage)?.usedPercent ?? 0}
              size={iconSize.action}
            />
          </Pressable>
        </WorkspaceAccountUsagePopover>
      )}
      {!readOnly && !newChat && (
        <ThreadHeaderMenu
          key={thread.id}
          threadId={thread.id}
          archived={archived}
          pinned={pinned}
          onOpenMenu={dismissComposerKeyboardForOverlay}
          onRenameRequest={openThreadRename}
          {...(onTogglePin === undefined ? {} : { onTogglePin })}
          {...(archived
            ? onUnarchive === undefined
              ? {}
              : { onUnarchive }
            : onArchive === undefined
              ? {}
              : { onArchive })}
          {...(onCompact === undefined ? {} : { onCompact })}
          {...(onFork === undefined ? {} : { onFork })}
          {...(deleteThread === undefined ? {} : { onDelete: deleteThread })}
        />
      )}
    </View>
  );
}
