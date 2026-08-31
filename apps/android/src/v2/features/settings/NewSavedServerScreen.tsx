import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { useV2Runtime } from "../../V2Application";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { WorkspaceView } from "../../ui/layouts/WorkspaceView";
import { serverDestination } from "../navigation/routeDestinations";

export function NewSavedServerScreen(): React.JSX.Element {
  const runtime = useV2Runtime();
  const [pairingLink, setPairingLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <WorkspaceView title="Add server">
      <View style={styles.form}>
        <Text style={styles.help}>
          Run codewide-host pair on the host, then paste its one-time connection link.
        </Text>
        <TextInput
          accessibilityLabel="Pairing link"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          onChangeText={setPairingLink}
          placeholder="codewide://pair?..."
          placeholderTextColor="#77777c"
          style={styles.input}
          value={pairingLink}
        />
        {error === null ? null : <Text style={styles.error}>{error}</Text>}
        <ActionPressable
          action={{
            disabled: pairingLink.trim() === "",
            id: "pair-saved-server",
            label: "Connect server",
            run: async () => {
              setError(null);
              try {
                const id = await runtime.pairSavedServerLink(pairingLink.trim());
                router.replace(serverDestination(id));
              } catch {
                setError(
                  "Could not pair this server. Check that the one-time link is valid and unexpired.",
                );
              }
            },
          }}
        />
      </View>
    </WorkspaceView>
  );
}

const styles = StyleSheet.create({
  error: { color: "#ff8b8b" },
  form: { gap: 12, padding: 16 },
  help: { color: "#c5c5c9", lineHeight: 21 },
  input: {
    backgroundColor: "#1b1b1e",
    borderRadius: 10,
    color: "#fafafa",
    minHeight: 120,
    padding: 12,
    textAlignVertical: "top",
  },
});
