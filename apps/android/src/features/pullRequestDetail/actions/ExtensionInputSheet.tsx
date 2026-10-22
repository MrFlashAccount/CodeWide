import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor, ActionInput } from "../../../data/forgeActionCatalog";
import { AppButton } from "../../../presentation/controls/AppButton";
import { AppText as Text, AppTextInput } from "../../../ui/Typography";
import { AppSwitch } from "../../../ui/AppSwitch";
import { colors, controlSize, radii, spacing, typeScale } from "../../../theme";
import { AppSheet } from "../../../ui/AppSheet";

type InputValue = boolean | string;

function initialValue(input: ActionInput): InputValue {
  if (input.type === "boolean") {
    return false;
  }
  return input.type === "enum" ? (input.options[0]?.value ?? "") : "";
}

/**
 * Collects the input a plugin action declares (text, choice or yes/no) before
 * it runs. Confirmation still follows at the action's effective level.
 */
export function ExtensionInputSheet({
  action,
  onDismiss,
  onSubmit,
}: {
  readonly action: ActionDescriptor & { readonly input: ActionInput };
  readonly onDismiss: () => void;
  readonly onSubmit: (value: InputValue) => void;
}): React.JSX.Element {
  const [value, setValue] = useState<InputValue>(() => initialValue(action.input));
  const empty =
    typeof value === "string" && action.input.type === "text" && value.trim().length === 0;
  return (
    <AppSheet
      contentProps={{ dismissLabel: `Close ${action.label}` }}
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
    >
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          {action.label}
        </Text>
        <Text style={styles.label}>{action.input.label}</Text>
        <InputField input={action.input} onChange={setValue} value={value} />
        <AppButton
          isDisabled={empty}
          onPress={() => {
            onSubmit(value);
          }}
        >
          {action.label}
        </AppButton>
      </View>
    </AppSheet>
  );
}

function InputField({
  input,
  onChange,
  value,
}: {
  readonly input: ActionInput;
  readonly onChange: (value: InputValue) => void;
  readonly value: InputValue;
}): React.JSX.Element {
  if (input.type === "boolean") {
    return (
      <AppSwitch accessibilityLabel={input.label} onValueChange={onChange} value={value === true} />
    );
  }
  if (input.type === "enum") {
    return (
      <View>
        {input.options.map((option) => (
          <ChoiceOption
            key={option.value}
            label={option.label}
            onSelect={onChange}
            selected={option.value === value}
            value={option.value}
          />
        ))}
      </View>
    );
  }
  return (
    <AppTextInput
      accessibilityLabel={input.label}
      onChangeText={onChange}
      placeholder={input.placeholder ?? undefined}
      style={styles.input}
      value={typeof value === "string" ? value : ""}
    />
  );
}

function ChoiceOption({
  label,
  onSelect,
  selected,
  value,
}: {
  readonly label: string;
  readonly onSelect: (value: string) => void;
  readonly selected: boolean;
  readonly value: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={() => {
        onSelect(value);
      }}
      style={styles.option}
    >
      <Text style={styles.optionLabel}>{selected ? `✓ ${label}` : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  input: {
    ...typeScale.body,
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.small,
    color: colors.text,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  label: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  option: {
    justifyContent: "center",
    minHeight: controlSize.touch,
  },
  optionLabel: {
    ...typeScale.body,
    color: colors.text,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
  },
});
