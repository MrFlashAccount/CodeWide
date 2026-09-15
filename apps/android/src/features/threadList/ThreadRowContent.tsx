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
  thread,
  server,
  selected,
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
              <ThreadTitle value={thread.title} running={false} />
            )}
          </View>
          {thread.state !== undefined && thread.state !== null && thread.state !== "running" && (
            <View
              accessible
              accessibilityLabel={`Thread ${thread.state}`}
              style={styles.threadStatusIcon}
            >
              <Ionicons
                name={thread.state === "approval" ? "shield-checkmark" : "alert-circle"}
                size={iconSize.inline}
                color={thread.state === "failed" ? colors.red : colors.amber}
              />
            </View>
          )}
          <View style={styles.threadMeta}>
            {thread.unread > 0 && (
              <View style={styles.unreadSlot}>
                <View
                  accessible
                  accessibilityLabel={`${thread.unread} unread ${thread.unread === 1 ? "message" : "messages"}`}
                  style={styles.unreadDot}
                />
              </View>
            )}
            <Text testID="thread-time" numberOfLines={1} style={styles.threadTime}>
              {thread.time ?? formatThreadTime(thread.timestamp ?? 0)}
            </Text>
          </View>
        </View>
        <View style={styles.threadPreviewLine}>
          <Text testID="thread-preview" numberOfLines={1} style={styles.threadPreview}>
            {plainThreadPreview(thread.preview)}
          </Text>
        </View>
      </View>
    </>
  );
}
