import { ConnectionEditFields } from "./ConnectionEditFields";
import { useConnectionEditor } from "./connectionEditor";
import type { ConnectionEditorProps } from "./connectionEditorContract";
import { ConnectionStatus } from "./ConnectionStatus";
/** V1 ConnectionRowEditor owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { useState } from "react";
import { Platform, Pressable, Switch, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { useAppDialog } from "../../ui/AppDialog";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { AccountPoolEditor } from "../accounts/AccountPoolFeature";
import { connectionDiagnosticReport } from "./connectionDiagnosticReport";
import { styles } from "./ConnectionRowEditor.styles";

export function ConnectionRowEditor({
  accountPool,
  connection,
  onActivateAccountProfile,
  onCancelAccountLogin,
  onDelete,
  onMove,
  onReconnect,
  onRefreshAccountPool,
  onRemoveAccountProfile,
  onStartAccountLogin,
  onToggle,
  onUpdate,
  onUpdateAccountProfile,
}: ConnectionEditorProps) {
  const {
    cancelEditing,
    editing,
    emoji,
    endpoint,
    error,
    name,
    replacementToken,
    save,
    saving,
    setEditing,
    setEmoji,
    setEndpoint,
    setName,
    setReplacementToken,
    setTlsPinSha256,
    tlsPinSha256,
  } = useConnectionEditor({ connection, onUpdate });
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const dialog = useAppDialog();
  const runAction = (operation: () => Promise<void>, fallback: string): void => {
    if (actionPending) {
      return;
    }
    setActionPending(true);
    operation().then(
      () => {
        setActionPending(false);
      },
      (error: unknown) => {
        setActionPending(false);
        dialog.alert(fallback, error instanceof Error ? error.message : fallback);
      },
    );
  };
  const connectionActions: ActionMenuItem[] = [
    {
      disabled: actionPending || !connection.enabled,
      icon: "refresh",
      id: "reconnect",
      label: "Reconnect",
    },
    { disabled: actionPending, icon: "pencil-outline", id: "edit", label: "Edit server" },
    { disabled: actionPending, icon: "arrow-up", id: "move-up", label: "Move up" },
    { disabled: actionPending, icon: "arrow-down", id: "move-down", label: "Move down" },
    {
      destructive: true,
      disabled: actionPending,
      icon: "trash-outline",
      id: "delete",
      label: "Delete server",
    },
  ];
  const secureLive = connection.enabled && connection.state === "live";
  const copyDiagnostic = async () => {
    if (connection.lastError === null) {
      return;
    }
    await Clipboard.setStringAsync(
      connectionDiagnosticReport({
        appVersion: Constants.expoConfig?.version ?? null,
        connectionId: connection.id,
        enabled: connection.enabled,
        error: connection.lastError,
        occurredAt: connection.lastErrorAt,
        platform: Platform.OS,
        platformVersion: Platform.Version,
        state: connection.state,
      }),
    );
  };
  const handleConnectionAction = (id: string) => {
    if (id === "reconnect") {
      runAction(async () => {
        await onReconnect(connection.id);
      }, "Could not reconnect server");
    } else if (id === "edit") {
      setEditing(true);
    } else if (id === "move-up") {
      runAction(async () => {
        await onMove(connection.id, -1);
      }, "Could not move server");
    } else if (id === "move-down") {
      runAction(async () => {
        await onMove(connection.id, 1);
      }, "Could not move server");
    } else if (id === "delete") {
      dialog.alert("Delete server?", `Remove ${connection.displayName} from this device?`, [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            runAction(async () => {
              await onDelete(connection.id);
            }, "Could not delete server");
          },
          style: "destructive",
          text: "Delete",
        },
      ]);
    }
  };
  return (
    <View style={styles.connectionEditor}>
      {editing ? (
        <ConnectionEditFields
          cancelEditing={cancelEditing}
          connection={connection}
          emoji={emoji}
          endpoint={endpoint}
          error={error}
          name={name}
          replacementToken={replacementToken}
          save={save}
          saving={saving}
          setEmoji={setEmoji}
          setEndpoint={setEndpoint}
          setName={setName}
          setReplacementToken={setReplacementToken}
          setTlsPinSha256={setTlsPinSha256}
          tlsPinSha256={tlsPinSha256}
        />
      ) : (
        <View style={styles.connectionRow}>
          <AppListRow
            description={connection.endpoint}
            descriptionLeading={
              secureLive ? (
                <Ionicons
                  accessibilityLabel="Secure connection"
                  color={colors.green}
                  name="lock-closed"
                  size={iconSize.indicator}
                />
              ) : undefined
            }
            fixedHeight={listRowHeight.double}
            leadingIcon={{ color: colors.textMuted, name: "server-outline", size: iconSize.action }}
            title="Connection"
            trailing={
              <>
                <Switch
                  accessibilityLabel={`Enable ${connection.displayName}`}
                  onValueChange={(enabled) => void onToggle(connection.id, enabled)}
                  value={connection.enabled}
                />
                <ActionMenu
                  accessibilityLabel={`Actions for ${connection.displayName}`}
                  actions={connectionActions}
                  onSelect={handleConnectionAction}
                  style={styles.connectionActionMenuAnchor}
                >
                  <Pressable
                    accessibilityLabel={`Actions for ${connection.displayName}`}
                    style={styles.connectionMiniButton}
                  >
                    <Ionicons
                      color={colors.textMuted}
                      name="ellipsis-horizontal"
                      size={iconSize.action}
                    />
                  </Pressable>
                </ActionMenu>
              </>
            }
          />
          <ConnectionStatus
            connection={connection}
            copyDiagnostic={copyDiagnostic}
            diagnosticExpanded={diagnosticExpanded}
            secureLive={secureLive}
            setDiagnosticExpanded={setDiagnosticExpanded}
          />
          {onRefreshAccountPool !== undefined &&
            onStartAccountLogin !== undefined &&
            onCancelAccountLogin !== undefined &&
            onActivateAccountProfile !== undefined &&
            onUpdateAccountProfile !== undefined &&
            onRemoveAccountProfile !== undefined && (
              <AccountPoolEditor
                accountPool={accountPool}
                connectionId={connection.id}
                onActivate={onActivateAccountProfile}
                onCancelLogin={onCancelAccountLogin}
                onRefresh={onRefreshAccountPool}
                onRemove={onRemoveAccountProfile}
                onStartLogin={onStartAccountLogin}
                onUpdate={onUpdateAccountProfile}
              />
            )}
        </View>
      )}
    </View>
  );
}
