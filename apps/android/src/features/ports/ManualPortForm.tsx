import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, Switch, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { type FormState } from "./portForwardingForm";
import { styles } from "./PortForwardingManager.styles";
import { InlineError } from "./PortPresentation";
export function ManualPortForm(props: {
  serverName: string;
  form: FormState;
  submitting: boolean;
  error: string | null;
  onChange(next: FormState): void;
  onBack(): void;
  onSubmit(): void;
  onRemove?: () => void;
}) {
  const update = (patch: Partial<FormState>) => props.onChange({ ...props.form, ...patch });
  return (
    <View testID="port-forwarding-form" style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to open ports"
          onPress={props.onBack}
          style={styles.iconButton}
        >
          <Ionicons name="arrow-back" size={iconSize.action} color={colors.text} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{props.form.id === null ? "Manual port" : "Edit port"}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {props.serverName}
          </Text>
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.formContent}>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          accessibilityLabel="Forwarding name"
          value={props.form.label}
          onChangeText={(label) => update({ label })}
          placeholder="Frontend"
          placeholderTextColor={colors.textDim}
          style={styles.textInput}
        />
        <View style={styles.formGroup}>
          <PortField
            label="Remote port"
            hint="server localhost"
            accessibilityLabel="Remote server port"
            value={props.form.remotePort}
            onChange={(remotePort) => update({ remotePort })}
          />
          <View style={styles.divider} />
          <PortField
            label="Phone port"
            hint="automatic if empty"
            accessibilityLabel="Preferred phone port"
            value={props.form.localPort}
            placeholder="Auto"
            onChange={(localPort) => update({ localPort })}
          />
          <View style={styles.divider} />
          <View style={styles.switchRow}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Start now</Text>
              <Text style={styles.rowSubtitle}>Keep available on this phone</Text>
            </View>
            <Switch
              value={props.form.startImmediately}
              onValueChange={(startImmediately) => update({ startImmediately })}
            />
          </View>
        </View>
        {props.error !== null && <InlineError value={props.error} />}
        <View style={styles.formActions}>
          {props.onRemove !== undefined && (
            <Pressable
              accessibilityLabel="Remove forwarding"
              disabled={props.submitting}
              onPress={props.onRemove}
              style={styles.removeButton}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityLabel={
              props.form.id === null ? "Forward port" : "Apply forwarding changes"
            }
            disabled={props.submitting}
            onPress={props.onSubmit}
            style={styles.primaryButton}
          >
            {props.submitting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.primaryText}>{props.form.id === null ? "Forward" : "Apply"}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

export function PortField(props: {
  label: string;
  hint: string;
  accessibilityLabel: string;
  value: string;
  placeholder?: string;
  onChange(value: string): void;
}) {
  return (
    <View style={styles.portField}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{props.label}</Text>
        <Text style={styles.rowSubtitle}>{props.hint}</Text>
      </View>
      <TextInput
        accessibilityLabel={props.accessibilityLabel}
        keyboardType="number-pad"
        maxLength={5}
        value={props.value}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textDim}
        onChangeText={props.onChange}
        style={styles.portInput}
      />
    </View>
  );
}
