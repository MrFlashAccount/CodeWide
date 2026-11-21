import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SubagentWorkspace.styles";

export function SubagentMasterHeader({
  onClose,
  subagentCount,
}: {
  readonly onClose: () => void;
  readonly subagentCount: number;
}): React.JSX.Element {
  return (
    <View style={styles.masterHeader}>
      <Pressable
        accessibilityLabel="Back to conversation"
        onPress={onClose}
        style={styles.iconButton}
      >
        <Ionicons color={colors.text} name="arrow-back" size={iconSize.navigation} />
      </Pressable>
      <Text numberOfLines={1} style={[styles.headerTitle, styles.masterTitle]}>
        Subagents
      </Text>
      <Text accessibilityLabel={subagentCountLabel(subagentCount)} style={styles.headerCount}>
        {subagentCount}
      </Text>
    </View>
  );
}

function subagentCountLabel(count: number): string {
  return `${String(count)} ${count === 1 ? "subagent" : "subagents"}`;
}
