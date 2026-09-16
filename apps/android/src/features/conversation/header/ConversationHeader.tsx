import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { contextUsageFromProjection } from "../../../data/account-rate-limits";
import { colors, iconSize } from "../../../theme";
import { InlineEmoji } from "../../../ui/InlineIcon";
import { leadingEmoji } from "../../../ui/ThreadTitle";
import { AppText as Text } from "../../../ui/Typography";
import { ContextRing } from "../../accounts/UsageMenu";
import { WorkspaceAccountUsageMenu } from "../../accounts/WorkspaceAccountUsageMenu";
import { ThreadHeaderMenu } from "../../turnActions/ThreadActions";
import {
  ConversationBackendRefreshIndicator,
  ConversationHistorySubtitle,
} from "../ConversationHistoryStatus";
import { styles } from "./ConversationHeader.styles";
import type { ConversationHeaderProps } from "./ConversationHeaderContract";

export function ConversationHeader({
  accountRateLimitsDatabase,
  archived,
  closeThreadSearch,
  compact,
  currentUsage,
  cwd,
  deleteThread,
  dismissComposerKeyboardForOverlay,
  draftConnectionId,
  draftThreadId,
  historyActivityModel,
  historyActivityResourceId,
  newChat,
  onArchive,
  onBack,
  onCompact,
  onFork,
  onRefreshAccountRateLimits,
  onTogglePin,
  onUnarchive,
  openThreadRename,
  pinned,
  readOnly,
  remoteThread,
  server,
  sessionCompactionCount,
  setThreadSearchVisible,
  thread,
  threadChatModel,
  threadSearchVisible,
}: ConversationHeaderProps) {
  return (
    <View style={styles.conversationHeader} testID="conversation-header">
      {compact && (
        <Pressable accessibilityLabel="Back to threads" onPress={onBack} style={styles.headerIcon}>
          <Ionicons color={colors.text} name="arrow-back" size={iconSize.navigation} />
        </Pressable>
      )}
      <View style={[styles.conversationIdentity, !compact && styles.conversationIdentityRaised]}>
        <View style={styles.conversationTitleRow}>
          {leadingEmoji(thread.title) !== null && (
            <InlineEmoji role="title" value={leadingEmoji(thread.title) ?? ""} />
          )}
          <Text
            ellipsizeMode="tail"
            numberOfLines={1}
            style={[styles.conversationTitle, styles.conversationHeaderTitle]}
            testID="conversation-title"
          >
            {thread.title.slice(leadingEmoji(thread.title)?.length ?? 0).trimStart()}
          </Text>
          <ConversationBackendRefreshIndicator
            connectionId={draftConnectionId}
            model={threadChatModel}
            threadId={draftThreadId}
          />
        </View>
        <ConversationHistorySubtitle
          cwd={cwd}
          model={historyActivityModel}
          resourceId={historyActivityResourceId}
          server={server}
        />
      </View>
      {!newChat && (
        <Pressable
          accessibilityLabel="Search in thread"
          onPress={() => {
            if (threadSearchVisible) {
              closeThreadSearch();
            } else {
              setThreadSearchVisible(true);
            }
          }}
          style={styles.headerIcon}
        >
          <Ionicons color={colors.text} name="search" size={iconSize.action} />
        </Pressable>
      )}
      {!newChat && (
        <WorkspaceAccountUsageMenu
          align="end"
          compactionCount={sessionCompactionCount}
          currentUsage={currentUsage}
          database={accountRateLimitsDatabase}
          placement="bottom"
          servers={[
            {
              id: server?.id ?? "active-server",
              name: server?.name ?? "Server",
            },
          ]}
          thread={remoteThread ?? null}
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
        </WorkspaceAccountUsageMenu>
      )}
      {!readOnly && !newChat && (
        <ThreadHeaderMenu
          archived={archived}
          key={thread.id}
          onOpenMenu={dismissComposerKeyboardForOverlay}
          onRenameRequest={openThreadRename}
          pinned={pinned}
          threadId={thread.id}
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
