import { useRef, useState, useTransition } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../theme";
import { AppModalDialog } from "../../presentation/overlay/AppModalDialog";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { WaveText } from "../../ui/WaveText";

interface ThreadRenameDialogProps {
  onClose: () => void;
  onRename?: (name: string) => Promise<void>;
  title: string;
  visible: boolean;
}

export function ThreadRenameDialog(props: ThreadRenameDialogProps) {
  return <ThreadRenameDialogSession key={props.visible ? props.title : "closed"} {...props} />;
}

function ThreadRenameDialogSession(props: ThreadRenameDialogProps) {
  const initialName = useConstant(() => props.title);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const submitting = useRef(false);
  const disabled = saving || name.trim() === "" || props.onRename === undefined;
  const close = useEvent(() => {
    if (!submitting.current) {
      props.onClose();
    }
  });
  const save = useEvent(() => {
    const rename = props.onRename;
    const next = name.trim();
    if (submitting.current || next === "" || rename === undefined) {
      return;
    }
    // Enter and the button share one in-flight action, including before React commits pending.
    submitting.current = true;
    setError(null);
    startSaving(async () => {
      try {
        await rename(next);
        submitting.current = false;
        props.onClose();
      } catch (error) {
        submitting.current = false;
        setError(error instanceof Error ? error.message : "Could not rename thread");
      }
    });
  });
  return (
    <AppModalDialog
      contentStyle={styles.content}
      dismissOnBackdrop={!saving}
      onDismiss={close}
      open={props.visible}
      testID="thread-rename-dialog"
    >
      <KeyboardAvoidingView
        behavior="padding"
        pointerEvents="box-none"
        style={styles.keyboardLayout}
        testID="thread-rename-keyboard-layout"
      >
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Rename thread</Text>
          <TextInput
            accessibilityLabel="Thread name"
            autoFocus
            editable={!saving}
            onChangeText={setName}
            onSubmitEditing={save}
            returnKeyType="done"
            selectTextOnFocus
            style={styles.input}
            value={name}
          />
          {error !== null && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="Cancel"
              accessibilityRole="button"
              disabled={saving}
              onPress={close}
              style={styles.button}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Save"
              accessibilityRole="button"
              accessibilityState={{ busy: saving, disabled }}
              disabled={disabled}
              onPress={save}
              style={[styles.button, styles.saveButton, disabled && styles.disabled]}
            >
              {saving ? (
                <WaveText style={styles.saveText} text="Saving…" />
              ) : (
                <Text style={styles.saveText}>Save</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </AppModalDialog>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-end",
  },
  button: {
    alignItems: "center",
    borderRadius: radii.medium,
    justifyContent: "center",
    minHeight: controlSize.regular,
    minWidth: controlSize.touch,
    paddingHorizontal: spacing.md,
  },
  cancelText: {
    color: colors.textMuted,
    ...typeScale.body,
    fontWeight: typeWeight.medium,
  },
  content: {
    padding: 0,
  },
  disabled: { opacity: 0.5 },
  error: {
    color: colors.red,
    ...typeScale.label,
  },
  form: {
    gap: spacing.md,
    padding: spacing.md,
  },
  input: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    color: colors.text,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
    ...typeScale.body,
  },
  keyboardLayout: {
    width: "100%",
  },
  saveButton: { backgroundColor: colors.primary },
  saveText: {
    color: colors.onPrimary,
    ...typeScale.body,
    fontWeight: typeWeight.medium,
  },
  title: {
    color: colors.text,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
});
