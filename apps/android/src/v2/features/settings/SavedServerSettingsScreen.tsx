import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useSyncExternalStore, useTransition } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import {
  PresentationTextInput as TextInput,
  ProductText as Text,
} from "../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";

interface SavedServerSettingsScreenProps {
  onDeleted(): void | Promise<void>;
  savedServerId: SavedServerId;
}

interface SavedServerFormState {
  emoji: string;
  endpoint: string;
  name: string;
  replacementToken: string;
  tlsPinSha256: string;
}

export function SavedServerSettingsScreen(
  props: SavedServerSettingsScreenProps,
): React.JSX.Element {
  const { onDeleted, savedServerId } = props;
  const runtime = useV2Runtime();
  const [resource] = useState(() => runtime.savedServerConnection(savedServerId));
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const server = servers.value.find((candidate) => candidate.id === savedServerId);
  const connection = snapshot.value;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<SavedServerFormState>({
    emoji: server?.emoji ?? "🖥️",
    endpoint: connection?.endpoint ?? server?.endpoint ?? "",
    name: server?.displayName ?? "Server",
    replacementToken: "",
    tlsPinSha256: connection?.tlsPinSha256 ?? "",
  });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startAction] = useTransition();
  const close = useEvent(() => router.back());
  const resetForm = useEvent(() => {
    setForm({
      emoji: server?.emoji ?? "🖥️",
      endpoint: connection?.endpoint ?? server?.endpoint ?? "",
      name: server?.displayName ?? "Server",
      replacementToken: "",
      tlsPinSha256: connection?.tlsPinSha256 ?? "",
    });
  });
  const beginEdit = useEvent(() => {
    resetForm();
    setEditing(true);
  });
  const cancelEdit = useEvent(() => {
    resetForm();
    setError(null);
    setEditing(false);
  });
  const save = useEvent(() => {
    const replacementToken = form.replacementToken.trim() === "" ? null : form.replacementToken;
    setError(null);
    startAction(async () => {
      try {
        await runtime.updateSavedServer(savedServerId, {
          displayName: form.name,
          emoji: form.emoji,
          endpoint: form.endpoint,
          replacementToken,
          tlsPinSha256: form.tlsPinSha256,
        });
        setForm((current) => ({ ...current, replacementToken: "" }));
        setEditing(false);
        await resource.refresh();
      } catch {
        setError("Could not update server.");
      }
    });
  });
  const toggle = useEvent((enabled: boolean) => {
    setError(null);
    startAction(async () => {
      try {
        await runtime.setSavedServerEnabled(savedServerId, enabled);
        await resource.refresh();
      } catch {
        setError("Could not update this server.");
      }
    });
  });
  const action = useEvent((id: string) => {
    if (id === "reconnect") runtime.reconnect(savedServerId);
    else if (id === "edit") beginEdit();
    else if (id === "move-up" || id === "move-down") {
      startAction(async () => runtime.moveSavedServer(savedServerId, id === "move-up" ? -1 : 1));
    } else if (id === "delete") setConfirmingDelete(true);
  });
  const cancelDelete = useEvent(() => setConfirmingDelete(false));
  const changeEmoji = useEvent((emoji: string) => setForm((current) => ({ ...current, emoji })));
  const changeName = useEvent((name: string) => setForm((current) => ({ ...current, name })));
  const changeEndpoint = useEvent((endpoint: string) =>
    setForm((current) => ({ ...current, endpoint })),
  );
  const changeReplacementToken = useEvent((replacementToken: string) =>
    setForm((current) => ({ ...current, replacementToken })),
  );
  const changeTlsPin = useEvent((tlsPinSha256: string) =>
    setForm((current) => ({ ...current, tlsPinSha256 })),
  );
  const confirmDelete = useEvent(() => {
    setError(null);
    startAction(async () => {
      try {
        await runtime.deleteSavedServer(savedServerId);
        await onDeleted();
      } catch {
        setError("Could not delete this saved server.");
      }
    });
  });
  const actions: ActionMenuItem[] = [
    {
      disabled: connection?.enabled !== true,
      icon: "refresh",
      id: "reconnect",
      label: "Reconnect",
    },
    { icon: "pencil-outline", id: "edit", label: "Edit server" },
    { icon: "arrow-up", id: "move-up", label: "Move up" },
    { icon: "arrow-down", id: "move-down", label: "Move down" },
    { destructive: true, icon: "trash-outline", id: "delete", label: "Delete server" },
  ];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Close server settings"
          onPress={close}
          style={styles.iconButton}
        >
          <Ionicons color={colors.text} name="arrow-back" size={21} />
        </Pressable>
        <Text style={styles.title}>Server settings</Text>
      </View>
      {connection === null || server === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator
            accessibilityLabel="Loading server settings"
            color={colors.textMuted}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {editing ? (
            <View style={styles.form}>
              <View style={styles.identityFields}>
                <TextInput
                  accessibilityLabel={`Emoji for ${server.displayName}`}
                  onChangeText={changeEmoji}
                  style={styles.emojiInput}
                  value={form.emoji}
                />
                <TextInput
                  accessibilityLabel={`Name for ${server.displayName}`}
                  onChangeText={changeName}
                  style={styles.fieldInputFlex}
                  value={form.name}
                />
              </View>
              <Text style={styles.fieldLabel}>Secure endpoint</Text>
              <TextInput
                accessibilityLabel={`Endpoint for ${server.displayName}`}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={changeEndpoint}
                style={styles.fieldInput}
                value={form.endpoint}
              />
              <Text style={styles.fieldLabel}>
                Replacement capability (leave blank to keep current)
              </Text>
              <TextInput
                accessibilityLabel={`Replacement capability for ${server.displayName}`}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={changeReplacementToken}
                secureTextEntry
                style={styles.fieldInput}
                value={form.replacementToken}
              />
              <Text style={styles.fieldLabel}>Companion identity pin (required)</Text>
              <TextInput
                accessibilityLabel={`TLS pin for ${server.displayName}`}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={changeTlsPin}
                style={styles.fieldInput}
                value={form.tlsPinSha256}
              />
              {error === null ? null : <Text style={styles.error}>{error}</Text>}
              <View style={styles.actions}>
                <Pressable
                  accessibilityLabel={`Cancel editing ${server.displayName}`}
                  disabled={pending}
                  onPress={cancelEdit}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryText}>Cancel</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Save ${server.displayName}`}
                  disabled={pending}
                  onPress={save}
                  style={styles.primaryButton}
                >
                  {pending ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.primaryText}>Save</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.serverEditor}>
              <View style={styles.serverRow}>
                <Text style={styles.serverEmoji}>{server.emoji}</Text>
                <View style={styles.serverText}>
                  <Text numberOfLines={1} style={styles.serverName}>
                    {server.displayName}
                  </Text>
                  <Text ellipsizeMode="middle" numberOfLines={1} style={styles.serverEndpoint}>
                    {connection.endpoint}
                  </Text>
                  <View style={styles.stateRow}>
                    <View
                      style={[
                        styles.stateDot,
                        { backgroundColor: connection.enabled ? colors.green : colors.textDim },
                      ]}
                    />
                    <Text
                      style={[
                        styles.stateText,
                        { color: connection.enabled ? colors.green : colors.textDim },
                      ]}
                    >
                      {connection.enabled ? "Connected" : "Disabled"}
                    </Text>
                    {connection.tlsPinSha256 === null ? null : (
                      <Text style={styles.pinned}>TLS pinned</Text>
                    )}
                  </View>
                </View>
                {pending ? <ActivityIndicator color={colors.textMuted} size="small" /> : null}
                <Switch
                  accessibilityLabel={`Enable ${server.displayName}`}
                  disabled={pending}
                  onValueChange={toggle}
                  value={connection.enabled}
                />
                <ActionMenu
                  accessibilityLabel={`Actions for ${server.displayName}`}
                  actions={actions}
                  onSelect={action}
                  style={styles.menuAnchor}
                >
                  <Pressable
                    accessibilityLabel={`Actions for ${server.displayName}`}
                    style={styles.iconButton}
                  >
                    <Ionicons color={colors.textMuted} name="ellipsis-horizontal" size={20} />
                  </Pressable>
                </ActionMenu>
              </View>
              {error === null ? null : <Text style={styles.error}>{error}</Text>}
              {confirmingDelete ? (
                <View style={styles.danger}>
                  <Text style={styles.dangerText}>
                    Delete {server.displayName} and all of its local V2 data from this device?
                  </Text>
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityLabel="Cancel delete server"
                      disabled={pending}
                      onPress={cancelDelete}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryText}>Keep server</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Confirm delete server"
                      disabled={pending}
                      onPress={confirmDelete}
                      style={styles.deleteButton}
                    >
                      <Text style={styles.deleteText}>Delete server</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>
      )}
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
  center: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { padding: spacing.md },
  danger: {
    backgroundColor: colors.errorContainer,
    borderRadius: radii.selected,
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  dangerText: { color: colors.red, ...typeScale.body },
  deleteButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  deleteText: { color: colors.red, ...typeScale.body },
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
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 58,
    paddingHorizontal: spacing.sm,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  identityFields: { flexDirection: "row", gap: spacing.xs },
  menuAnchor: { height: touchTarget, width: touchTarget },
  pinned: { color: colors.textMuted, ...typeScale.caption },
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
  root: { backgroundColor: colors.surface, flex: 1, minHeight: 0 },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  secondaryText: { color: colors.text, ...typeScale.body },
  serverEditor: { borderBottomColor: colors.borderSoft, borderBottomWidth: 1 },
  serverEmoji: { ...typeScale.emoji },
  serverEndpoint: { color: colors.textMuted, ...typeScale.label },
  serverName: { color: colors.text, ...typeScale.title },
  serverRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 72,
    paddingVertical: spacing.xs,
  },
  serverText: { flex: 1, minWidth: 0 },
  stateDot: { borderRadius: 4, height: 7, width: 7 },
  stateRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xxs,
    minHeight: 18,
  },
  stateText: { ...typeScale.caption, fontWeight: typeWeight.semibold },
  title: { color: colors.text, flex: 1, ...typeScale.heading },
});
