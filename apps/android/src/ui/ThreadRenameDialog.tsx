import { Dialog } from "heroui-native/dialog";
import { useRef, useState, useTransition } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { AppText as Text, AppTextInput as TextInput } from "./Typography";
import { WaveText } from "./WaveText";

interface ThreadRenameDialogProps {
  visible: boolean;
  title: string;
  onClose(): void;
  onRename?(name: string): Promise<void>;
}

export function ThreadRenameDialog(props: ThreadRenameDialogProps) {
  const [name, setName] = useState(props.title);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const submitting = useRef(false);
  const disabled = saving || name.trim() === "" || props.onRename === undefined;
  const close = useEvent(() => { if (!submitting.current) props.onClose(); });
  const save = useEvent(() => {
    const rename = props.onRename;
    const next = name.trim();
    if (submitting.current || next === "" || rename === undefined) return;
    // Enter and the button share one in-flight action, including before React commits pending.
    submitting.current = true;
    setError(null);
    startSaving(async () => {
      try {
        await rename(next);
        submitting.current = false;
        props.onClose();
      } catch (cause) {
        submitting.current = false;
        setError(cause instanceof Error ? cause.message : "Could not rename thread");
      }
    });
  });
  const changeOpen = useEvent((open: boolean) => { if (!open) close(); });
  return (
    <Dialog isOpen={props.visible} onOpenChange={changeOpen}>
      <Dialog.Portal style={styles.portal}>
        <Dialog.Overlay isCloseOnPress={!saving} />
        <KeyboardAvoidingView testID="thread-rename-keyboard-layout" behavior="padding" pointerEvents="box-none" style={styles.keyboardLayout}>
          <Dialog.Content testID="thread-rename-dialog" style={styles.content}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
              <Dialog.Title style={styles.title}>Rename thread</Dialog.Title>
              <TextInput
                autoFocus selectTextOnFocus accessibilityLabel="Thread name"
                value={name} onChangeText={setName} editable={!saving}
                returnKeyType="done" onSubmitEditing={save} style={styles.input}
              />
              {error !== null && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={saving} onPress={close} style={styles.button}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Save" accessibilityState={{ disabled, busy: saving }} disabled={disabled} onPress={save} style={[styles.button, styles.saveButton, disabled && styles.disabled]}>
                  {saving ? <WaveText text="Saving…" style={styles.saveText} /> : <Text style={styles.saveText}>Save</Text>}
                </Pressable>
              </View>
            </ScrollView>
          </Dialog.Content>
        </KeyboardAvoidingView>
      </Dialog.Portal>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  portal: { position: "absolute", inset: 0 },
  keyboardLayout: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.md },
  content: { width: "100%", maxWidth: 420, maxHeight: "100%", padding: 0, borderRadius: radii.large, backgroundColor: colors.surfaceContainerHigh },
  form: { padding: spacing.md, gap: spacing.md },
  title: { color: colors.text, ...typeScale.title, fontWeight: typeWeight.semibold },
  input: { minHeight: controlSize.touch, paddingHorizontal: spacing.sm, borderRadius: radii.medium, backgroundColor: colors.surfaceContainerLow, color: colors.text, ...typeScale.body },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.xs },
  button: { minHeight: controlSize.regular, minWidth: controlSize.touch, paddingHorizontal: spacing.md, borderRadius: radii.medium, alignItems: "center", justifyContent: "center" },
  saveButton: { backgroundColor: colors.primary },
  disabled: { opacity: 0.5 },
  cancelText: { color: colors.textMuted, ...typeScale.body, fontWeight: typeWeight.medium },
  saveText: { color: colors.onPrimary, ...typeScale.body, fontWeight: typeWeight.medium },
  error: { color: colors.red, ...typeScale.label },
});
