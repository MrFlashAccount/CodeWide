import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, iconSize } from "../theme";
import { AppText } from "./Typography";
import { styles } from "./WorkspaceTabsEmptyState.styles";

/** Consistent first-use surface; creation remains an explicit feature-owned action. */
export function WorkspaceTabsEmptyState(props: {
  readonly createLabel: string;
  readonly onCreate: () => void;
  readonly title: string;
}): React.JSX.Element {
  return (
    <View style={styles.root}>
      <AppText style={styles.title}>{props.title}</AppText>
      <Pressable
        accessibilityLabel={props.createLabel}
        accessibilityRole="button"
        onPress={props.onCreate}
        style={({ pressed }) => [styles.create, pressed && styles.pressed]}
      >
        <Ionicons color={colors.onPrimary} name="add" size={iconSize.action} />
        <AppText style={styles.createLabel}>{props.createLabel}</AppText>
      </Pressable>
    </View>
  );
}
