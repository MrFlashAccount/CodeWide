import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { formatThreadTime } from "../../data/device-time";
import { plainThreadPreview } from "../../data/thread-cache";
import { colors, iconSize } from "../../theme";
import { RunningThreadTitle, ThreadTitle } from "../../ui/ThreadTitle";
import { AppText as Text } from "../../ui/Typography";
import { serverGlyph } from "../connections/connectionPresentation";
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
            <Text accessibilityLabel={`Server ${server.name}`} style={styles.threadServerEmoji}>
              {serverGlyph(server)}
            </Text>
          )}
          <View style={styles.threadTitleSlot}>
            {thread.state === "running" ? (
              <RunningThreadTitle value={thread.title} />
            ) : (
              <ThreadTitle running={false} value={thread.title} />
            )}
          </View>
          {thread.state !== undefined && thread.state !== "running" && (
            <View
              accessibilityLabel={`Thread ${thread.state}`}
              accessible
              style={styles.threadStatusIcon}
            >
              <Ionicons
                color={thread.state === "failed" ? colors.red : colors.amber}
                name={thread.state === "approval" ? "shield-checkmark" : "alert-circle"}
                size={iconSize.inline}
              />
            </View>
          )}
          <View style={styles.threadMeta}>
            {thread.unread > 0 && (
              <View style={styles.unreadSlot}>
                <View
                  accessibilityLabel={`${String(thread.unread)} unread ${thread.unread === 1 ? "message" : "messages"}`}
                  accessible
                  style={styles.unreadDot}
                />
              </View>
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
