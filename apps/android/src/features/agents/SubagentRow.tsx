import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { formatDeviceTime } from "../../data/device-time";
import { subagentDisplayName, subagentIsActive } from "../../data/subagent-projection";
import { plainThreadPreview } from "../../data/thread-cache";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { WaveText } from "../../ui/WaveText";
import { styles } from "./SubagentWorkspace.styles";

export function SubagentRow({
  summary,
  selected,
  onPress,
}: {
  summary: StoredThreadSummary;
  selected: boolean;
  onPress(): void;
}) {
  const active = subagentIsActive(summary);
  const title = subagentDisplayName(summary);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open subagent ${title}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          {active ? (
            <WaveText
              testID={`subagent-active-${summary.remoteThreadId}`}
              text={title}
              style={styles.rowTitle}
              containerStyle={styles.rowTitleWave}
            />
          ) : (
            <Text numberOfLines={1} style={styles.rowTitle}>
              {title}
            </Text>
          )}
          {summary.status.type === "systemError" && (
            <View accessibilityLabel="Subagent failed" style={styles.statusIcon}>
              <Ionicons name="alert-circle" size={iconSize.inline} color={colors.red} />
            </View>
          )}
          <View style={styles.rowMeta}>
            {summary.unread > 0 && (
              <View style={styles.unreadSlot}>
                <View
                  accessibilityLabel={`${summary.unread} unread ${summary.unread === 1 ? "message" : "messages"}`}
                  style={styles.unreadDot}
                />
              </View>
            )}
            <Text numberOfLines={1} style={styles.time}>
              {formatDeviceTime(summary.recencyAt ?? summary.updatedAt)}
            </Text>
          </View>
        </View>
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.preview}>
          {subagentPreview(summary)}
        </Text>
      </View>
    </Pressable>
  );
}

export function subagentSubtitle(summary: StoredThreadSummary): string {
  if (summary.status.type === "notLoaded") return summary.agentRole || "Subagent";
  const state =
    summary.status.type === "active"
      ? "running"
      : summary.status.type === "systemError"
        ? "failed"
        : "idle";
  return summary.agentRole ? `${summary.agentRole} · ${state}` : state;
}

function subagentPreview(summary: StoredThreadSummary): string {
  const preview = plainThreadPreview(summary.preview);
  return preview === "" ? subagentSubtitle(summary) : preview;
}

export function subagentRowsEqual(left: StoredThreadSummary, right: StoredThreadSummary): boolean {
  return (
    left === right ||
    (left.remoteThreadId === right.remoteThreadId &&
      left.name === right.name &&
      left.agentNickname === right.agentNickname &&
      left.agentRole === right.agentRole &&
      left.preview === right.preview &&
      left.status.type === right.status.type &&
      left.updatedAt === right.updatedAt &&
      left.recencyAt === right.recencyAt &&
      left.unread === right.unread)
  );
}
