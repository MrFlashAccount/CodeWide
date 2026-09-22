import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./QuestionCard.styles";

/** Numbered suggestion; selecting a row edits the draft without sending it. */
export function QuestionOption({
  description,
  disabled,
  index,
  label,
  onSelect,
  selected,
}: {
  description: string;
  disabled: boolean;
  index: number;
  label: string;
  onSelect: () => void;
  selected: boolean;
}): React.JSX.Element {
  const select = useEvent(onSelect);
  return (
    <Pressable
      accessibilityLabel={description === "" ? label : `${label}. ${description}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={select}
      style={[styles.option, selected && styles.selected]}
    >
      <View style={styles.number}>
        <Text style={styles.numberText}>{index + 1}</Text>
      </View>
      <View style={styles.optionBody}>
        <Text style={styles.optionText}>{label}</Text>
        {description !== "" && <Text style={styles.description}>{description}</Text>}
      </View>
      {selected && (
        <Ionicons color={colors.textMuted} name="arrow-forward" size={iconSize.inline} />
      )}
    </Pressable>
  );
}
