import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";
import { colors, iconSize } from "../../theme";
import { styles } from "./NewThreadFloatingButton.styles";

export function NewThreadFloatingButton({
  projectName,
  onPress,
}: {
  projectName: string | null;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityLabel={projectName === null ? "New thread" : `New thread in ${projectName}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.newThreadFab, pressed && styles.pressed]}
    >
      <Ionicons name="create-outline" size={iconSize.navigation} color={colors.onPrimary} />
    </Pressable>
  );
}
