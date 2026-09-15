/** V1 ConnectionRowEditor owner, extracted without changing interaction or resource lifetime. */
import { Pressable, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { styles } from "./ConnectionRowEditor.styles";

import type { ConnectionEditor } from "./connectionEditor";
import type { ConnectionEditorProps } from "./connectionEditorContract";

export function ConnectionEditFields({
  connection,
  name,
  setName,
  emoji,
  setEmoji,
  endpoint,
  setEndpoint,
  replacementToken,
  setReplacementToken,
  tlsPinSha256,
  setTlsPinSha256,
  saving,
  error,
  cancelEditing,
  save,
}: Omit<ConnectionEditor, "editing" | "setEditing"> & Pick<ConnectionEditorProps, "connection">) {
  return (
    <View style={styles.connectionEditorForm}>
      <View style={styles.connectionIdentityFields}>
        <TextInput
          voiceInput={false}
          accessibilityLabel={`Emoji for ${connection.displayName}`}
          value={emoji}
          onChangeText={setEmoji}
          style={styles.connectionEmojiInput}
        />
        <TextInput
          accessibilityLabel={`Name for ${connection.displayName}`}
          value={name}
          onChangeText={setName}
          style={[styles.fieldInput, styles.flex]}
        />
      </View>
      <Text style={styles.fieldLabel}>Secure endpoint</Text>
      <TextInput
        voiceInput={false}
        accessibilityLabel={`Endpoint for ${connection.displayName}`}
        value={endpoint}
        onChangeText={setEndpoint}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.fieldInput}
      />
      <Text style={styles.fieldLabel}>Replacement capability (leave blank to keep current)</Text>
      <TextInput
        accessibilityLabel={`Replacement capability for ${connection.displayName}`}
        value={replacementToken}
        onChangeText={setReplacementToken}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={styles.fieldInput}
      />
      <Text style={styles.fieldLabel}>Companion identity pin (required)</Text>
      <TextInput
        voiceInput={false}
        accessibilityLabel={`TLS pin for ${connection.displayName}`}
        value={tlsPinSha256}
        onChangeText={setTlsPinSha256}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.fieldInput}
      />
      {error !== null && <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.sheetActions}>
        <Pressable
          accessibilityLabel={`Cancel editing ${connection.displayName}`}
          disabled={saving}
          onPress={cancelEditing}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Save ${connection.displayName}`}
          disabled={saving}
          onPress={() => void save()}
          style={[styles.primaryButton, saving && styles.disabled]}
        >
          <Text style={styles.primaryButtonText}>{saving ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>
    </View>
  );
}
