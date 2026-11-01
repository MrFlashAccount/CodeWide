import { Ionicons } from "@expo/vector-icons";
import type { Ref } from "react";
import { Pressable, View } from "react-native";
import { formatDeviceTime } from "../../data/device-time";
import { subagentDisplayName, subagentIsActive } from "../../data/subagent-projection";
import { plainThreadPreview } from "../../data/thread-cache";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { WaveText } from "../../ui/WaveText";
import { subagentLineageAccessibility, type SubagentLineage } from "./lineageProjection";
import { styles } from "./SubagentWorkspace.styles";

export function SubagentRow({
  focusRef,
  lineage,
  onPress,
  selected,
  summary,
}: {
  focusRef?: Ref<View>;
  lineage: SubagentLineage;
  onPress: () => void;
  selected: boolean;
  summary: StoredThreadSummary;
}) {
  const active = subagentIsActive(summary);
  const title = subagentDisplayName(summary);
  const accessibilityLabel = subagentRowAccessibilityLabel(title, summary, lineage);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      ref={focusRef}
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
              containerStyle={styles.rowTitleWave}
              style={styles.rowTitle}
              testID={`subagent-active-${summary.remoteThreadId}`}
              text={title}
            />
          ) : (
            <Text numberOfLines={1} style={styles.rowTitle}>
              {title}
            </Text>
          )}
          {summary.status.type === "systemError" && (
            <View accessibilityLabel="Subagent failed" style={styles.statusIcon}>
              <Ionicons color={colors.red} name="alert-circle" size={iconSize.inline} />
            </View>
          )}
          <View style={styles.rowMeta}>
            {summary.unread > 0 && (
              <View style={styles.unreadSlot}>
                <View
                  accessibilityLabel={`${String(summary.unread)} unread ${summary.unread === 1 ? "message" : "messages"}`}
                  style={styles.unreadDot}
                />
              </View>
            )}
            <Text numberOfLines={1} style={styles.time}>
              {formatDeviceTime(summary.recencyAt ?? summary.updatedAt)}
            </Text>
          </View>
        </View>
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.preview}>
          {subagentPreview(summary)}
        </Text>
      </View>
    </Pressable>
  );
}

function subagentRowAccessibilityLabel(
  title: string,
  summary: StoredThreadSummary,
  lineage: SubagentLineage,
): string {
  const parts = [
    `Open subagent ${title}`,
    lineage.status === "known" ? subagentLineageAccessibility(lineage) : "lineage unavailable",
  ];
  if (subagentIsActive(summary)) {
    parts.push("active");
  } else if (summary.status.type === "systemError") {
    parts.push("failed");
  }
  if (summary.unread > 0) {
    parts.push(`${String(summary.unread)} unread ${summary.unread === 1 ? "message" : "messages"}`);
  }
  return parts.join(", ");
}

// WHY: This presenter owns the user-visible fallback order between role and lifecycle state;
// changing that precedence would alter existing subagent labels.
// oxlint-disable-next-line eslint/complexity
export function subagentSubtitle(summary: StoredThreadSummary): string {
  const role = summary.agentRole;
  if (summary.status.type === "notLoaded") {
    return role === null || role === undefined || role === "" ? "Subagent" : role;
  }
  const state =
    summary.status.type === "active"
      ? "running"
      : summary.status.type === "systemError"
        ? "failed"
        : "idle";
  return role === null || role === undefined || role === "" ? state : `${role} · ${state}`;
}

function subagentPreview(summary: StoredThreadSummary): string {
  const preview = plainThreadPreview(summary.preview);
  return preview === "" ? subagentSubtitle(summary) : preview;
}

// WHY: This comparator is the memoization contract for one complete subagent row; all displayed
// fields must remain in the same equality decision to prevent stale row content.
// oxlint-disable-next-line eslint/complexity
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
