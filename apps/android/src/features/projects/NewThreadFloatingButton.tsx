import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";
import { colors, iconSize } from "../../theme";
import { styles } from "./NewThreadFloatingButton.styles";

export function NewThreadFloatingButton({
  onPress,
  projectName,
}: {
  onPress: () => void;
  projectName: string | null;
}) {
  return (
    <Pressable
      accessibilityLabel={projectName === null ? "New thread" : `New thread in ${projectName}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.newThreadFab, pressed && styles.pressed]}
    >
      <Ionicons color={colors.onPrimary} name="create-outline" size={iconSize.navigation} />
    </Pressable>
  );
}
