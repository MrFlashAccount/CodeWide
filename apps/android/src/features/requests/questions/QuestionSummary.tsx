import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, controlHitSlop, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./QuestionCard.styles";

/** Question identity and explicit dismissal; closing never submits a selected option. */
export function QuestionHeading({
  count,
  onSkip,
  page,
  skipDisabled,
  status,
}: {
  count: number;
  onSkip: (() => void) | undefined;
  page: number;
  skipDisabled: boolean;
  status: string;
}): React.JSX.Element {
  return (
    <View style={styles.header}>
      <Ionicons
        color={colors.textMuted}
        name="chatbubble-ellipses-outline"
        size={iconSize.inline}
      />
      <Text accessibilityLabel={status} style={styles.label}>
        {count > 1 ? `Вопрос ${String(page + 1)} из ${String(count)}` : "Вопрос"}
      </Text>
      {onSkip !== undefined && (
        <Pressable
          accessibilityLabel="Пропустить вопрос"
          accessibilityRole="button"
          accessibilityState={{ disabled: skipDisabled }}
          disabled={skipDisabled}
          hitSlop={controlHitSlop.compact}
          onPress={onSkip}
          style={[styles.close, skipDisabled && styles.disabled]}
        >
          <Ionicons color={colors.textMuted} name="close" size={iconSize.inline} />
        </Pressable>
      )}
    </View>
  );
}
