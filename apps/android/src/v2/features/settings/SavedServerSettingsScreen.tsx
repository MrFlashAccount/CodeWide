import { Ionicons } from "@expo/vector-icons";
import { setStringAsync } from "expo-clipboard";
import { router } from "expo-router";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import type { SavedServer } from "../../domain/savedServer";
import type { SavedServerConnection } from "../../application/ports/savedServerRepository";
import type { ResourceSnapshot } from "../../application/resources/resource";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { SavedServerForm, type SavedServerFormState } from "./SavedServerForm";
import { SavedServerSummary } from "./SavedServerSummary";
import { accountSettingsDestination } from "../navigation/routeDestinations";
import { ActionButtonView } from "../../presentation/actions/ActionButtonView";
import { useAsyncAction } from "../../presentation/actions/useAsyncAction";
import { VoiceTextInput } from "../conversation/VoiceTextInput";

interface SavedServerSettingsScreenProps {
  onDeleted(): void | Promise<void>;
  savedServerId: SavedServerId;
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
  const connectionStatuses = useSyncExternalStore(
    runtime.connectionStatuses.subscribe,
    runtime.connectionStatuses.snapshot,
    runtime.connectionStatuses.snapshot,
  );
  const server = servers.value.find((candidate) => candidate.id === savedServerId);
  const connection = snapshot.value;
  const connectionStatus = connectionStatuses.value.get(savedServerId) ?? {
    detail: null,
    state: connection?.enabled === false ? "disabled" : "connecting",
  };
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
  const moveAction = useAsyncAction();
  const saveAction = useAsyncAction();
  const close = useEvent(() => router.back());
  const leaveUnavailableServer = useEvent(() => {
    Promise.resolve(onDeleted()).catch(() => setError("Could not return to saved servers."));
  });
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
    saveAction.run({
      action: async () => {
        await runtime.updateSavedServer(savedServerId, {
          displayName: form.name,
          emoji: form.emoji,
          endpoint: form.endpoint,
          replacementToken,
          tlsPinSha256: form.tlsPinSha256,
        });
        await resource.refresh();
        setForm((current) => ({ ...current, replacementToken: "" }));
        setEditing(false);
      },
      failure: "Could not update server.",
      pending: "Saving server…",
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
    else if (id === "accounts") router.push(accountSettingsDestination(savedServerId));
    else if (id === "copy-diagnostic" && connectionStatus.detail !== null) {
      setStringAsync(connectionStatus.detail).catch(() =>
        setError("Could not copy the connection error."),
      );
    } else if (id === "edit") beginEdit();
    else if (id === "move-up" || id === "move-down") {
      const direction = id === "move-up" ? -1 : 1;
      moveAction.run({
        action: async () => runtime.moveSavedServer(savedServerId, direction),
        failure: "Could not reorder saved servers.",
        pending: "Reordering servers…",
      });
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
      label: "Retry connection",
    },
    { disabled: connection?.enabled !== true, icon: "people", id: "accounts", label: "Accounts" },
    { icon: "pencil-outline", id: "edit", label: "Edit server" },
    { icon: "arrow-up", id: "move-up", label: "Move up" },
    { icon: "arrow-down", id: "move-down", label: "Move down" },
    { destructive: true, icon: "trash-outline", id: "delete", label: "Delete server" },
  ];
  if (connectionStatus.detail !== null) {
    actions.splice(2, 0, {
      icon: "copy-outline",
      id: "copy-diagnostic",
      label: "Copy connection error",
    });
  }
  const unavailableMessage = savedServerUnavailableMessage({
    connection,
    server,
    servers,
    snapshot,
  });

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
      {unavailableMessage !== null ? (
        <View style={styles.center}>
          <Text style={styles.unavailableText}>{unavailableMessage}</Text>
          <ActionButtonView
            disabled={false}
            label="Back to servers"
            onPress={leaveUnavailableServer}
            pending={false}
          />
        </View>
      ) : connection === null || server === undefined ? (
        <View style={styles.center}>
          <ShimmerText style={styles.loadingText} text="Loading server settings…" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {editing ? (
            <SavedServerForm
              error={saveAction.error ?? error}
              form={form}
              onCancel={cancelEdit}
              onEmojiChange={changeEmoji}
              onEndpointChange={changeEndpoint}
              onNameChange={changeName}
              onReplacementTokenChange={changeReplacementToken}
              onSave={save}
              onTlsPinChange={changeTlsPin}
              pending={pending || saveAction.pending}
              // WHY: This is a render prop; repository callback policy delegates its identity to React Compiler instead of stabilizing it with useEvent/useCallback.
              // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
              renderNameInput={(inputProps) => (
                <VoiceTextInput
                  {...inputProps}
                  audience={savedServerId}
                  scope={{ id: `server-name:${savedServerId}`, kind: "generic" }}
                  thread={null}
                  value={typeof inputProps.value === "string" ? inputProps.value : ""}
                />
              )}
              serverName={server.displayName}
            />
          ) : (
            <SavedServerSummary
              actions={actions}
              confirmingDelete={confirmingDelete}
              connection={connection}
              error={moveAction.error ?? error}
              onAction={action}
              onCancelDelete={cancelDelete}
              onConfirmDelete={confirmDelete}
              {...(moveAction.error === null ? {} : { onRetryError: moveAction.retry })}
              onToggle={toggle}
              pending={pending || moveAction.pending}
              server={server}
              status={connectionStatus}
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, justifyContent: "center" },
  content: { padding: spacing.md },
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
  loadingText: { color: colors.textMuted, ...typeScale.body },
  root: { backgroundColor: colors.surface, flex: 1, minHeight: 0 },
  title: { color: colors.text, flex: 1, ...typeScale.heading },
  unavailableText: { color: colors.textMuted, marginBottom: spacing.md, ...typeScale.body },
});

interface SavedServerUnavailableInput {
  connection: SavedServerConnection | null;
  server: SavedServer | undefined;
  servers: ResourceSnapshot<SavedServer[]>;
  snapshot: ResourceSnapshot<SavedServerConnection | null>;
}

function savedServerUnavailableMessage(input: SavedServerUnavailableInput): string | null {
  const { connection, server, servers, snapshot } = input;
  if (servers.status === "error" && server === undefined) return servers.message;
  if (servers.status === "ready" && server === undefined) {
    return "This saved server no longer exists.";
  }
  if (snapshot.status === "error" && connection === null) return snapshot.message;
  if (snapshot.status === "ready" && connection === null) {
    return "This saved server connection no longer exists.";
  }
  return null;
}
