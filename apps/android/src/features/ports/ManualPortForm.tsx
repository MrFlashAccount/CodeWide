import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, ScrollView, Switch, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import type { FormState } from "./portForwardingForm";
import { styles } from "./PortForwardingManager.styles";
import { InlineError } from "./PortPresentation";

export function ManualPortForm(props: {
  error: string | null;
  form: FormState;
  onBack: () => void;
  onChange: (next: FormState) => void;
  onRemove?: () => void;
  onSubmit: () => void;
  serverName: string;
  submitting: boolean;
}) {
  const update = (patch: Partial<FormState>) => {
    props.onChange({ ...props.form, ...patch });
  };
  return (
    <View style={styles.root} testID="port-forwarding-form">
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back to open ports"
          accessibilityRole="button"
          onPress={props.onBack}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="arrow-back" size={iconSize.action} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{props.form.id === null ? "Manual port" : "Edit port"}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {props.serverName}
          </Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          accessibilityLabel="Forwarding name"
          onChangeText={(label) => {
            update({ label });
          }}
          placeholder="Frontend"
          placeholderTextColor={colors.textDim}
          style={styles.textInput}
          value={props.form.label}
        />
        <View style={styles.formGroup}>
          <PortField
            accessibilityLabel="Remote server port"
            hint="server localhost"
            label="Remote port"
            onChange={(remotePort) => {
              update({ remotePort });
            }}
            value={props.form.remotePort}
          />
          <View style={styles.divider} />
          <PortField
            accessibilityLabel="Preferred phone port"
            hint="automatic if empty"
            label="Phone port"
            onChange={(localPort) => {
              update({ localPort });
            }}
            placeholder="Auto"
            value={props.form.localPort}
          />
          <View style={styles.divider} />
          <View style={styles.switchRow}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Start now</Text>
              <Text style={styles.rowSubtitle}>Keep available on this phone</Text>
            </View>
            <Switch
              onValueChange={(startImmediately) => {
                update({ startImmediately });
              }}
              value={props.form.startImmediately}
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

function PortField(props: {
  accessibilityLabel: string;
  hint: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
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
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textDim}
        style={styles.portInput}
        value={props.value}
      />
    </View>
  );
}
