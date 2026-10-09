import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { formatThreadTime } from "../../data/device-time";
import { plainThreadPreview } from "../../data/thread-cache";
import { colors, iconSize } from "../../theme";
import { RunningThreadTitle, ThreadTitle } from "../../ui/ThreadTitle";
import { AppText as Text } from "../../ui/Typography";
import { ServerIcon } from "../connections/ServerIcon";
import { styles } from "./ThreadRow.styles";
import type { ThreadRowProps } from "./threadRowContract";

export function ThreadRowContent({
  selected,
  server,
  thread,
}: Pick<ThreadRowProps, "thread" | "server" | "selected">) {
  return (
    <>
      {selected && <View style={styles.selectionBar} />}
      <View style={styles.threadText}>
        <View style={styles.threadTitleLine}>
          {server !== undefined && (
            <View accessibilityLabel={`Server ${server.name}`} accessible>
              <ServerIcon color={colors.textMuted} iconId={server.iconId} metric="body" />
            </View>
          )}
          <View style={styles.threadTitleSlot}>
            {thread.state === "running" ? (
              <RunningThreadTitle value={thread.title} />
            ) : (
              <ThreadTitle running={false} value={thread.title} />
            )}
          </View>
          {thread.state === "failed" && (
            <View
              accessibilityLabel={`Thread ${thread.state}`}
              accessible
              style={styles.threadStatusIcon}
            >
              <Ionicons color={colors.red} name="alert-circle" size={iconSize.inline} />
            </View>
          )}
          <View style={styles.threadMeta}>
            {typeof thread.agentBadge === "string" && (
              <Text
                accessibilityLabel={`Agent ${thread.agentBadge}`}
                numberOfLines={1}
                style={styles.threadAgentBadge}
                testID="thread-agent-badge"
              >
                {thread.agentBadge}
              </Text>
            )}
            {thread.needsAttention === true ? (
              <View
                accessibilityLabel="Требуется твоё внимание"
                accessible
                style={styles.threadAttentionIcon}
              >
                <Ionicons color={colors.text} name="hand-left-outline" size={iconSize.indicator} />
              </View>
            ) : (
              thread.unread > 0 && (
                <View style={styles.unreadSlot}>
                  <View accessibilityLabel="Unread thread" accessible style={styles.unreadDot} />
                </View>
              )
            )}
            <Text numberOfLines={1} style={styles.threadTime} testID="thread-time">
              {thread.time ?? formatThreadTime(thread.timestamp ?? 0)}
            </Text>
          </View>
        </View>
        <View style={styles.threadPreviewLine}>
          <Text numberOfLines={1} style={styles.threadPreview} testID="thread-preview">
            {plainThreadPreview(thread.preview)}
          </Text>
        </View>
      </View>
    </>
  );
}
