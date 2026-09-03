import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  PresentationTextInput as TextInput,
  ProductText as Text,
} from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";

export interface SavedServerFormState {
  emoji: string;
  endpoint: string;
  name: string;
  replacementToken: string;
  tlsPinSha256: string;
}

interface SavedServerFormProps {
  error: string | null;
  form: SavedServerFormState;
  onCancel(): void;
  onEmojiChange(value: string): void;
  onEndpointChange(value: string): void;
  onNameChange(value: string): void;
  onReplacementTokenChange(value: string): void;
  onSave(): void;
  onTlsPinChange(value: string): void;
  pending: boolean;
  renderNameInput?(props: ComponentProps<typeof TextInput>): ReactNode;
  serverName: string;
}

export function SavedServerForm(props: SavedServerFormProps): React.JSX.Element {
  const {
    error,
    form,
    onCancel,
    onEmojiChange,
    onEndpointChange,
    onNameChange,
    onReplacementTokenChange,
    onSave,
    onTlsPinChange,
    pending,
    renderNameInput,
    serverName,
  } = props;
  return (
    <View style={styles.form}>
      <View style={styles.identityFields}>
        <TextInput
          accessibilityLabel={`Emoji for ${serverName}`}
          onChangeText={onEmojiChange}
          style={styles.emojiInput}
          value={form.emoji}
        />
        {renderNameInput?.({
          accessibilityLabel: `Name for ${serverName}`,
          onChangeText: onNameChange,
          style: styles.fieldInputFlex,
          value: form.name,
        }) ?? (
          <TextInput
            accessibilityLabel={`Name for ${serverName}`}
            onChangeText={onNameChange}
            style={styles.fieldInputFlex}
            value={form.name}
          />
        )}
      </View>
      <Text style={styles.fieldLabel}>Secure endpoint</Text>
      <TextInput
        accessibilityLabel={`Endpoint for ${serverName}`}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onEndpointChange}
        style={styles.fieldInput}
        value={form.endpoint}
      />
      <Text style={styles.fieldLabel}>Replacement capability (leave blank to keep current)</Text>
      <TextInput
        accessibilityLabel={`Replacement capability for ${serverName}`}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onReplacementTokenChange}
        secureTextEntry
        style={styles.fieldInput}
        value={form.replacementToken}
      />
      <Text style={styles.fieldLabel}>Companion identity pin (required)</Text>
      <TextInput
        accessibilityLabel={`TLS pin for ${serverName}`}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onTlsPinChange}
        style={styles.fieldInput}
        value={form.tlsPinSha256}
      />
      {error === null ? null : <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={`Cancel editing ${serverName}`}
          disabled={pending}
          onPress={onCancel}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Save ${serverName}`}
          disabled={pending}
          onPress={onSave}
          style={styles.primaryButton}
        >
          {pending ? (
            <ShimmerText style={styles.primaryText} text="Save" />
          ) : (
            <Text style={styles.primaryText}>Save</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-end",
    minHeight: touchTarget,
  },
  emojiInput: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.selected,
    ...typeScale.heading,
    minHeight: touchTarget,
    textAlign: "center",
    width: 58,
  },
  error: { color: colors.red, ...typeScale.label },
  fieldInput: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.selected,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  fieldInputFlex: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.selected,
    flex: 1,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  fieldLabel: { color: colors.textMuted, ...typeScale.label },
  form: { gap: spacing.xs },
  identityFields: { flexDirection: "row", gap: spacing.xs },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: touchTarget,
    minWidth: 96,
    paddingHorizontal: spacing.sm,
  },
  primaryText: { color: colors.onPrimary, ...typeScale.body },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  secondaryText: { color: colors.text, ...typeScale.body },
});
