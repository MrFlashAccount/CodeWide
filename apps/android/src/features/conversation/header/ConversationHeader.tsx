import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { contextUsageFromProjection } from "../../../data/account-rate-limits";
import { threadOpenElsewhere } from "../../../data/threadDirectInput";
import { DEFAULT_SERVER_ICON_ID } from "../../../data/serverIcons";
import { colors, iconSize } from "../../../theme";
import { InlineEmoji } from "../../../ui/InlineIcon";
import { leadingEmoji } from "../../../ui/ThreadTitle";
import { AppText as Text } from "../../../ui/Typography";
import { ContextRing } from "../../accounts/UsageMenu";
import { WorkspaceAccountUsageMenu } from "../../accounts/WorkspaceAccountUsageMenu";
import { ThreadHeaderMenu } from "../../turnActions/ThreadActions";
import type { ThreadHeaderHostItem } from "../../turnActions/threadHeaderContract";
import { ThreadForkSheet } from "../../turnActions/ThreadForkSheet";
import {
  ConversationBackendRefreshWarning,
  ConversationHistorySubtitle,
} from "../ConversationHistoryStatus";
import { styles } from "./ConversationHeader.styles";
import type {
  ConversationHeaderProps,
  ConversationHostPresentation,
} from "./ConversationHeaderContract";

const SCREEN: ConversationHostPresentation = { kind: "screen" };
const NO_HOST_ITEMS: readonly ThreadHeaderHostItem[] = [];

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
  forkOffer,
  forkPicker,
  historyActivityModel,
  historyActivityResourceId,
  identitySubtitle = null,
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
  presentation = SCREEN,
  providerLimits = null,
  readOnly,
  remoteThread,
  server,
  sessionCompactionCount,
  setThreadSearchVisible,
  thread,
  threadChatModel,
  threadSearchVisible,
}: ConversationHeaderProps) {
  const openElsewhere = threadOpenElsewhere(remoteThread);
  const pane = presentation.kind === "pane" ? presentation : null;
  const hostItems = pane?.menuItems ?? NO_HOST_ITEMS;
  // Every existing thread has its menu. A sub-agent's mutating actions show disabled; a thread
  // another app holds keeps its own narrower rule (only session actions are off).
  const threadMenu = !newChat;
  return (
    <View style={styles.conversationHeader} testID="conversation-header">
      {/* A pane closes from its trailing edge instead of navigating back. */}
      {compact && pane === null && (
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
          <ConversationBackendRefreshWarning
            connectionId={draftConnectionId}
            model={threadChatModel}
            threadId={draftThreadId}
          />
        </View>
        {identitySubtitle === null ? (
          <ConversationHistorySubtitle
            cwd={cwd}
            model={historyActivityModel}
            resourceId={historyActivityResourceId}
            server={server}
          />
        ) : (
          <Text
            accessibilityLabel={identitySubtitle}
            ellipsizeMode="middle"
            numberOfLines={1}
            style={styles.conversationIdentitySubtitle}
            testID="conversation-identity-subtitle"
          >
            {identitySubtitle}
          </Text>
        )}
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
          providerLimits={providerLimits}
          servers={[
            {
              iconId: server?.iconId ?? DEFAULT_SERVER_ICON_ID,
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
            accessibilityLabel={
              accountRateLimitsDatabase === null
                ? "Context usage"
                : "Context usage and account limits"
            }
            style={styles.headerIcon}
          >
            <ContextRing
              percent={contextUsageFromProjection(currentUsage)?.usedPercent ?? 0}
              size={iconSize.action}
            />
          </Pressable>
        </WorkspaceAccountUsageMenu>
      )}
      {threadMenu && (
        <ThreadHeaderMenu
          archived={archived}
          key={thread.id}
          onOpenMenu={dismissComposerKeyboardForOverlay}
          onRenameRequest={openThreadRename}
          openElsewhere={openElsewhere}
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
          {...(onCompact === undefined || openElsewhere ? {} : { onCompact })}
          {...(onFork === undefined ? {} : { onFork })}
          {...(forkOffer === undefined ? {} : { forkOffer })}
          {...(forkPicker === undefined ? {} : { forkPicker })}
          {...(deleteThread === undefined || openElsewhere ? {} : { onDelete: deleteThread })}
          hostItems={hostItems}
          readOnly={readOnly && !openElsewhere}
        />
      )}
      {pane !== null && (
        <Pressable
          accessibilityLabel={pane.closeLabel}
          accessibilityRole="button"
          onPress={onBack}
          style={styles.headerIcon}
        >
          <Ionicons color={colors.text} name="close" size={iconSize.action} />
        </Pressable>
      )}
      {/* Outside the menu gate: a message's "Fork" opens the sheet in a read-only thread too. */}
      {onFork !== undefined && forkPicker !== undefined && (
        <ThreadForkSheet onFork={onFork} picker={forkPicker} />
      )}
    </View>
  );
}
