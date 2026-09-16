import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, View } from "react-native";
import { subagentDisplayName } from "../../data/subagent-projection";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { subagentSubtitle } from "./SubagentRow";
import { styles } from "./SubagentWorkspace.styles";

/** Renders the retained status and progress of one pending subagent. */
export function SubagentPendingDetail({
  compact,
  error,
  loading,
  onBack,
  onClose,
  summary,
}: {
  compact: boolean;
  error: string | null;
  loading: boolean;
  onBack: () => void;
  onClose: () => void;
  summary: StoredThreadSummary;
}) {
  return (
    <View style={styles.pendingPane}>
      <View style={styles.detailHeader}>
        {compact && (
          <Pressable
            accessibilityLabel="Back to subagents"
            onPress={onBack}
            style={styles.iconButton}
          >
            <Ionicons color={colors.text} name="arrow-back" size={iconSize.navigation} />
          </Pressable>
        )}
        <View style={styles.headerIdentity}>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {subagentDisplayName(summary)}
          </Text>
          <Text numberOfLines={1} style={styles.headerSubtitle}>
            {subagentSubtitle(summary)}
          </Text>
        </View>
        {!compact && (
          <Pressable
            accessibilityLabel="Close subagents"
            onPress={onClose}
            style={styles.iconButton}
          >
            <Ionicons color={colors.text} name="close" size={iconSize.navigation} />
          </Pressable>
        )}
      </View>
      {error !== null ? (
        <Text selectable style={styles.error}>
          {error}
        </Text>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Loading subchat…</Text>
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.muted}>No messages yet</Text>
        </View>
      )}
    </View>
  );
}

export function EmptySelection() {
  return (
    <View style={styles.center}>
      <Ionicons color={colors.textDim} name="chatbubbles-outline" size={iconSize.illustration} />
      <Text style={styles.muted}>Select a subagent</Text>
    </View>
  );
}

export function EmptySubagents() {
  return (
    <View style={styles.empty}>
      <Ionicons color={colors.textDim} name="people-outline" size={iconSize.illustration} />
      <Text style={styles.muted}>No subagents in this thread</Text>
    </View>
  );
}
