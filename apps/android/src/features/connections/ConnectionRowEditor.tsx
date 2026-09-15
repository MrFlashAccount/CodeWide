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
  connection,
  onToggle,
  onReconnect,
  onDelete,
  onUpdate,
  onMove,
  accountPool,
  onRefreshAccountPool,
  onStartAccountLogin,
  onCancelAccountLogin,
  onActivateAccountProfile,
  onUpdateAccountProfile,
  onRemoveAccountProfile,
}: ConnectionEditorProps) {
  const {
    editing,
    setEditing,
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
  } = useConnectionEditor({ connection, onUpdate });
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(false);
  const dialog = useAppDialog();
  const connectionActions: ActionMenuItem[] = [
    { id: "reconnect", label: "Reconnect", icon: "refresh", disabled: !connection.enabled },
    { id: "edit", label: "Edit server", icon: "pencil-outline" },
    { id: "move-up", label: "Move up", icon: "arrow-up" },
    { id: "move-down", label: "Move down", icon: "arrow-down" },
    { id: "delete", label: "Delete server", icon: "trash-outline", destructive: true },
  ];
  const secureLive = connection.enabled && connection.state === "live";
  const copyDiagnostic = async () => {
    if (connection.lastError === null) return;
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
    if (id === "reconnect") void onReconnect(connection.id);
    else if (id === "edit") setEditing(true);
    else if (id === "move-up") void onMove(connection.id, -1);
    else if (id === "move-down") void onMove(connection.id, 1);
    else if (id === "delete") {
      dialog.alert("Delete server?", `Remove ${connection.displayName} from this device?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void onDelete(connection.id);
          },
        },
      ]);
    }
  };
  return (
    <View style={styles.connectionEditor}>
      {editing ? (
        <ConnectionEditFields
          connection={connection}
          name={name}
          setName={setName}
          emoji={emoji}
          setEmoji={setEmoji}
          endpoint={endpoint}
          setEndpoint={setEndpoint}
          replacementToken={replacementToken}
          setReplacementToken={setReplacementToken}
          tlsPinSha256={tlsPinSha256}
          setTlsPinSha256={setTlsPinSha256}
          saving={saving}
          error={error}
          cancelEditing={cancelEditing}
          save={save}
        />
      ) : (
        <View style={styles.connectionRow}>
          <AppListRow
            title="Connection"
            description={connection.endpoint}
            fixedHeight={listRowHeight.double}
            leadingIcon={{ name: "server-outline", size: iconSize.action, color: colors.textMuted }}
            descriptionLeading={
              secureLive ? (
                <Ionicons
                  accessibilityLabel="Secure connection"
                  name="lock-closed"
                  size={iconSize.indicator}
                  color={colors.green}
                />
              ) : undefined
            }
            trailing={
              <>
                <Switch
                  accessibilityLabel={`Enable ${connection.displayName}`}
                  value={connection.enabled}
                  onValueChange={(enabled) => void onToggle(connection.id, enabled)}
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
                      name="ellipsis-horizontal"
                      size={iconSize.action}
                      color={colors.textMuted}
                    />
                  </Pressable>
                </ActionMenu>
              </>
            }
          />
          <ConnectionStatus
            connection={connection}
            secureLive={secureLive}
            diagnosticExpanded={diagnosticExpanded}
            setDiagnosticExpanded={setDiagnosticExpanded}
            copyDiagnostic={copyDiagnostic}
          />
          {onRefreshAccountPool !== undefined &&
            onStartAccountLogin !== undefined &&
            onCancelAccountLogin !== undefined &&
            onActivateAccountProfile !== undefined &&
            onUpdateAccountProfile !== undefined &&
            onRemoveAccountProfile !== undefined && (
              <AccountPoolEditor
                connectionId={connection.id}
                accountPool={accountPool}
                onRefresh={onRefreshAccountPool}
                onStartLogin={onStartAccountLogin}
                onCancelLogin={onCancelAccountLogin}
                onActivate={onActivateAccountProfile}
                onUpdate={onUpdateAccountProfile}
                onRemove={onRemoveAccountProfile}
              />
            )}
        </View>
      )}
    </View>
  );
}
