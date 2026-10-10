import { ConnectionEditFields } from "./ConnectionEditFields";
import { useConnectionEditor } from "./connectionEditor";
import type { ConnectionEditorProps } from "./connectionEditorContract";
import { ConnectionStatus } from "./ConnectionStatus";
/** V1 ConnectionRowEditor owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { createElement, useState } from "react";
import { Platform, Pressable, Switch, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { useAppDialog } from "../../ui/AppDialog";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { SettingsGroupHeader } from "../../ui/SettingsGroupHeader";
import { AccountPoolEditor } from "../accounts/AccountPoolFeature";
import { ProviderAccounts } from "../accounts/ProviderAccounts";
import { AgentProviderMarks } from "./AgentProviderMarks";
import { connectionDiagnosticReport } from "./connectionDiagnosticReport";
import { connectionStateLabel } from "./connectionPresentation";
import { ServerIcon } from "./ServerIcon";
import { styles } from "./ConnectionRowEditor.styles";

export function ConnectionRowEditor({
  accountPool,
  agentProviders,
  connection,
  onActivateAccountProfile,
  onCancelAccountLogin,
  onConsumeAccountResetCredit,
  onDelete,
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
    endpoint,
    error,
    iconId,
    name,
    replacementToken,
    save,
    saving,
    setEditing,
    setEndpoint,
    setIconId,
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
    {
      destructive: true,
      disabled: actionPending,
      icon: "trash-outline",
      id: "delete",
      label: "Delete server",
    },
  ];
  const secureLive =
    connection.enabled &&
    (connection.health === undefined
      ? connection.state === "live"
      : connection.health === "online");
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
    } else if (id === "delete") {
      dialog.alert(
        "Delete server?",
        `Delete ${connection.displayName} and its local data from this phone? We’ll also try to remove this phone from Companion’s device list. History on the server is kept.`,
        [
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
        ],
      );
    }
  };
  return (
    <View style={styles.connectionEditor}>
      {editing ? (
        <ConnectionEditFields
          cancelEditing={cancelEditing}
          connection={connection}
          endpoint={endpoint}
          error={error}
          iconId={iconId}
          name={name}
          replacementToken={replacementToken}
          save={save}
          saving={saving}
          setEndpoint={setEndpoint}
          setIconId={setIconId}
          setName={setName}
          setReplacementToken={setReplacementToken}
          setTlsPinSha256={setTlsPinSha256}
          tlsPinSha256={tlsPinSha256}
        />
      ) : (
        <View style={styles.connectionRow}>
          <SettingsGroupHeader title="Connection" />
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
            leading={
              <View style={styles.leadingSlot}>
                {createElement(ServerIcon, { iconId: connection.iconId, metric: "body" })}
              </View>
            }
            title={connectionStateLabel(connection.state, connection.enabled, connection.health)}
            trailing={
              <>
                {agentProviders !== undefined && (
                  <AgentProviderMarks
                    agentProviders={agentProviders}
                    connectionId={connection.id}
                  />
                )}
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
            onConsumeAccountResetCredit !== undefined &&
            onActivateAccountProfile !== undefined &&
            onUpdateAccountProfile !== undefined &&
            onRemoveAccountProfile !== undefined && (
              <AccountPoolEditor
                accountPool={accountPool}
                {...(agentProviders === undefined ? {} : { agentProviders })}
                connectionId={connection.id}
                onActivate={onActivateAccountProfile}
                onCancelLogin={onCancelAccountLogin}
                onConsumeResetCredit={onConsumeAccountResetCredit}
                onRefresh={onRefreshAccountPool}
                onRemove={onRemoveAccountProfile}
                onStartLogin={onStartAccountLogin}
                onUpdate={onUpdateAccountProfile}
              />
            )}
          {agentProviders !== undefined && (
            <ProviderAccounts
              agentProviders={agentProviders}
              connectionId={connection.id}
              serverName={connection.displayName}
            />
          )}
        </View>
      )}
    </View>
  );
}
