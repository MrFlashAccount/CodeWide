import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { recordThreadNavigationVisualEvent } from "../../data/thread-navigation-metrics";
import { threadContextLabel } from "../../data/thread-projects";
import { colors, iconSize, layoutSize, radii, spacing, touchTarget, typeScale } from "../../theme";
import { CommitOnChangeProbe } from "../../ui/CommitProbe";
import { conversationChromeEdgeInset } from "../../ui/conversation-chrome-layout";
import { MessageListSkeleton } from "../../ui/MessageListBoundary";
import { emojiSafeTitle } from "../../ui/ThreadTitle";
import { AppText as Text } from "../../ui/Typography";
import { type ThreadListServer } from "../connections/connectionPresentation";
import { type ThreadListItem } from "../threadList/threadListTypes";

export function ConversationNavigationLoader({
  thread,
  server,
  cwd = "/workspace",
  compact = false,
  onBack,
}: {
  thread: ThreadListItem | null;
  server: ThreadListServer | undefined;
  cwd: string | undefined;
  compact: boolean | undefined;
  onBack: (() => void) | undefined;
}) {
  return (
    <View style={styles.conversation} testID="conversation-navigation-loader">
      <View style={styles.conversationKeyboard}>
        <View style={styles.conversationHeader}>
          {compact && onBack !== undefined ? (
            <Pressable
              onPress={onBack}
              style={styles.headerIcon}
              accessibilityLabel="Back to threads"
            >
              <Ionicons name="arrow-back" size={iconSize.navigation} color={colors.text} />
            </Pressable>
          ) : null}
          <View style={styles.conversationIdentity}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.conversationTitle}>
              {thread === null ? "Loading thread…" : emojiSafeTitle(thread.title)}
            </Text>
            <Text numberOfLines={1} ellipsizeMode="middle" style={styles.conversationSubtitle}>
              {threadContextLabel(server?.name ?? "", cwd)}
            </Text>
          </View>
        </View>
        <MessageListSkeleton />
      </View>
    </View>
  );
}
export function ConversationNavigationFallback({
  connectionId,
  threadId,
  navigationKey,
  ...loader
}: Parameters<typeof ConversationNavigationLoader>[0] & {
  connectionId: string;
  threadId: string | null;
  navigationKey: string;
}) {
  return (
    <>
      {threadId !== null && (
        <CommitOnChangeProbe
          scope={`conversation-fallback:${navigationKey}`}
          revision="visible"
          onCommit={() => {
            const navigationId = recordThreadNavigationVisualEvent(
              connectionId,
              threadId,
              "suspense_fallback_visible",
            );
            return navigationId === null
              ? undefined
              : () =>
                  recordThreadNavigationVisualEvent(
                    connectionId,
                    threadId,
                    "suspense_fallback_hidden",
                    {},
                    navigationId,
                  );
          }}
        />
      )}
      <ConversationNavigationLoader {...loader} />
    </>
  );
}
const styles = StyleSheet.create({
  headerIcon: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
  },
  conversation: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.conversationSurface,
  },
  conversationKeyboard: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    backgroundColor: colors.conversationSurface,
  },
  conversationHeader: {
    minHeight: layoutSize.header,
    paddingHorizontal: conversationChromeEdgeInset,
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
  },
  conversationIdentity: {
    flex: 1,
    minWidth: 0,
  },
  conversationTitle: {
    color: colors.text,
    ...typeScale.title,
  },
  conversationSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
    marginTop: spacing.optical,
  },
});
