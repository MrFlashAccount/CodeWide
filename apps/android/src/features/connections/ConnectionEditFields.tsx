/** V1 ConnectionRowEditor owner, extracted without changing interaction or resource lifetime. */
import { Pressable, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { styles } from "./ConnectionRowEditor.styles";

import type { ConnectionEditor } from "./connectionEditor";
import type { ConnectionEditorProps } from "./connectionEditorContract";

export function ConnectionEditFields({
  cancelEditing,
  connection,
  emoji,
  endpoint,
  error,
  name,
  replacementToken,
  save,
  saving,
  setEmoji,
  setEndpoint,
  setName,
  setReplacementToken,
  setTlsPinSha256,
  tlsPinSha256,
}: Omit<ConnectionEditor, "editing" | "setEditing"> & Pick<ConnectionEditorProps, "connection">) {
  return (
    <View style={styles.connectionEditorForm}>
      <View style={styles.connectionIdentityFields}>
        <TextInput
          accessibilityLabel={`Emoji for ${connection.displayName}`}
          onChangeText={setEmoji}
          style={styles.connectionEmojiInput}
          value={emoji}
          voiceInput={false}
        />
        <TextInput
          accessibilityLabel={`Name for ${connection.displayName}`}
          onChangeText={setName}
          style={[styles.fieldInput, styles.flex]}
          value={name}
        />
      </View>
      <Text style={styles.fieldLabel}>Secure endpoint</Text>
      <TextInput
        accessibilityLabel={`Endpoint for ${connection.displayName}`}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setEndpoint}
        style={styles.fieldInput}
        value={endpoint}
        voiceInput={false}
      />
      <Text style={styles.fieldLabel}>Replacement capability (leave blank to keep current)</Text>
      <TextInput
        accessibilityLabel={`Replacement capability for ${connection.displayName}`}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setReplacementToken}
        secureTextEntry
        style={styles.fieldInput}
        value={replacementToken}
      />
      <Text style={styles.fieldLabel}>Companion identity pin (required)</Text>
      <TextInput
        accessibilityLabel={`TLS pin for ${connection.displayName}`}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setTlsPinSha256}
        style={styles.fieldInput}
        value={tlsPinSha256}
        voiceInput={false}
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
