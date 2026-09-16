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
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { ThreadListItem } from "../threadList/threadListTypes";

export function ConversationNavigationLoader({
  compact = false,
  cwd = "/workspace",
  onBack,
  server,
  thread,
}: {
  compact: boolean | undefined;
  cwd: string | undefined;
  onBack: (() => void) | undefined;
  server: ThreadListServer | undefined;
  thread: ThreadListItem | null;
}) {
  return (
    <View style={styles.conversation} testID="conversation-navigation-loader">
      <View style={styles.conversationKeyboard}>
        <View style={styles.conversationHeader}>
          {compact && onBack !== undefined ? (
            <Pressable
              accessibilityLabel="Back to threads"
              onPress={onBack}
              style={styles.headerIcon}
            >
              <Ionicons color={colors.text} name="arrow-back" size={iconSize.navigation} />
            </Pressable>
          ) : null}
          <View style={styles.conversationIdentity}>
            <Text ellipsizeMode="tail" numberOfLines={1} style={styles.conversationTitle}>
              {thread === null ? "Loading thread…" : emojiSafeTitle(thread.title)}
            </Text>
            <Text ellipsizeMode="middle" numberOfLines={1} style={styles.conversationSubtitle}>
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
  navigationKey,
  threadId,
  ...loader
}: Parameters<typeof ConversationNavigationLoader>[0] & {
  connectionId: string;
  navigationKey: string;
  threadId: string | null;
}) {
  return (
    <>
      {threadId !== null && (
        <CommitOnChangeProbe
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
          revision="visible"
          scope={`conversation-fallback:${navigationKey}`}
        />
      )}
      <ConversationNavigationLoader {...loader} />
    </>
  );
}
const styles = StyleSheet.create({
  conversation: {
    backgroundColor: colors.conversationSurface,
    flex: 1,
    minWidth: 0,
  },
  conversationHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 0,
    minHeight: layoutSize.header,
    paddingHorizontal: conversationChromeEdgeInset,
  },
  conversationIdentity: {
    flex: 1,
    minWidth: 0,
  },
  conversationKeyboard: {
    alignSelf: "stretch",
    backgroundColor: colors.conversationSurface,
    flex: 1,
    minWidth: 0,
  },
  conversationSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
    marginTop: spacing.optical,
  },
  conversationTitle: {
    color: colors.text,
    ...typeScale.title,
  },
  headerIcon: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
});
