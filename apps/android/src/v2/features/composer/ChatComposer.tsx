import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export function ChatComposer({
  disabled,
  error,
  locked,
  onEdit,
  onSubmit,
  onTextChange,
  retryBlocked = false,
  text: controlledText,
}: {
  disabled: boolean;
  error?: string | null;
  locked?: boolean;
  onEdit?(): void;
  onSubmit(text: string): Promise<boolean>;
  onTextChange?(text: string): void;
  retryBlocked?: boolean;
  text?: string;
}): React.JSX.Element {
  const [uncontrolledText, setUncontrolledText] = useState("");
  const text = controlledText ?? uncontrolledText;
  const [sending, setSending] = useState(false);
  const submit = async (): Promise<void> => {
    const value = text.trim();
    if (disabled || locked === true || retryBlocked || sending || value.length === 0) {
      return;
    }
    setSending(true);
    await onSubmit(value)
      .then((completed) => {
        if (completed) {
          if (onTextChange === undefined) setUncontrolledText("");
          else onTextChange("");
        }
      })
      .finally(() => setSending(false));
  };
  return (
    <View style={styles.root}>
      <TextInput
        accessibilityLabel="V2 message composer"
        editable={!disabled && locked !== true && !sending}
        onChangeText={(value) => {
          if (onTextChange === undefined) setUncontrolledText(value);
          else onTextChange(value);
          onEdit?.();
        }}
        placeholder="Message"
        placeholderTextColor="#71717a"
        style={styles.input}
        value={text}
      />
      <Pressable
        accessibilityLabel="Send V2 message"
        accessibilityRole="button"
        accessibilityState={{
          busy: sending,
          disabled: disabled || locked === true || retryBlocked || sending,
        }}
        disabled={disabled || locked === true || retryBlocked || sending}
        onPress={() => void submit()}
        style={styles.send}
      >
        <Text style={styles.sendText}>Send</Text>
      </Pressable>
      {error === undefined || error === null ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    minHeight: 44,
    color: "#fafafa",
    backgroundColor: "#1c1c1f",
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  error: { color: "#ff8b8b" },
  root: { flexDirection: "row", gap: 8, padding: 12, borderTopColor: "#2e2e31", borderTopWidth: 1 },
  send: {
    backgroundColor: "#0369a1",
    borderRadius: 14,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  sendText: { color: "#fafafa", fontWeight: "700" },
});
