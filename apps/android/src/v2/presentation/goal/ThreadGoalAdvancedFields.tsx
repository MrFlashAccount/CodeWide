import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { PresentationTextInput, ProductText } from "../text/ProductText";

interface ThreadGoalAdvancedFieldsProps {
  disabled: boolean;
  onChange(value: string): void;
  value: string;
}

/** Keeps infrequent goal budget controls collapsed without hiding their state. */
export function ThreadGoalAdvancedFields(props: ThreadGoalAdvancedFieldsProps): React.JSX.Element {
  const { disabled, onChange, value } = props;
  const [expanded, setExpanded] = useState(false);
  const toggle = useEvent(() => setExpanded((current) => !current));
  return (
    <View style={styles.root}>
      <Pressable
        accessibilityLabel="Advanced goal options"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={toggle}
        style={styles.trigger}
      >
        <ProductText weight="medium">Advanced</ProductText>
        <PresentationIcon
          color={colors.textMuted}
          name={expanded ? "chevronUp" : "chevronDown"}
          size={18}
        />
      </Pressable>
      {expanded ? (
        <View style={styles.field}>
          <ProductText style={styles.label} weight="medium">
            Token budget
          </ProductText>
          <PresentationTextInput
            accessibilityLabel="Goal token budget"
            editable={!disabled}
            keyboardType="number-pad"
            maxLength={15}
            onChangeText={onChange}
            placeholder="No limit"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            value={value}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs, padding: spacing.sm },
  input: {
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.text,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    ...typeScale.body,
  },
  label: typeScale.label,
  root: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    overflow: "hidden",
  },
  trigger: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
});
