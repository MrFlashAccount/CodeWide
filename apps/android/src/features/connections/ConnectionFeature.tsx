/** V1 SettingsFeature owner, extracted without changing interaction or resource lifetime. */
import { View } from "react-native";
import { colors, iconSize } from "../../theme";
import { ConnectionActivityIndicator } from "./ConnectionActivityIndicator";
import { styles } from "./ConnectionFeature.styles";
import {
  connectionActivity,
  connectionStateColor,
  connectionStateLabel,
} from "./connectionPresentation";
import { ConnectionRowEditor } from "./ConnectionRowEditor";
import type { HostUpdateView } from "./hostUpdateSettingsContract";
import { ServerIcon } from "./ServerIcon";
import { ServerSoftwareSection } from "./ServerSoftwareSection";

import type { ConnectionSettingsProps } from "./connectionSettingsContract";

/** Presents qualified server status and editors through the public settings capability. */
export function connectionSettingsSections({
  accountRateLimits,
  agentProviders,
  connections,
  hostUpdates,
  onActivateAccountProfile,
  onApplyHostUpdate,
  onApplyRelayUpdate,
  onCancelAccountLogin,
  onCheckHostUpdate,
  onCheckRelayUpdate,
  onConsumeAccountResetCredit,
  onDelete,
  onReconnect,
  onRefreshAccountPool,
  onRemoveAccountProfile,
  onStartAccountLogin,
  onToggle,
  onUpdate,
  onUpdateAccountProfile,
  relayUpdates,
}: ConnectionSettingsProps) {
  return connections.map((connection) => {
    const hostUpdate = hostUpdates[connection.id];
    const relayUpdate = relayUpdates[connection.id];
    return {
      content: (
        <>
          <ConnectionRowEditor
            accountPool={
              accountRateLimits.find((row) => row.connectionId === connection.id)?.accountPool ??
              null
            }
            connection={connection}
            {...(agentProviders === undefined ? {} : { agentProviders })}
            onDelete={onDelete}
            onReconnect={onReconnect}
            onToggle={onToggle}
            onUpdate={onUpdate}
            {...(onRefreshAccountPool === undefined ? {} : { onRefreshAccountPool })}
            {...(onStartAccountLogin === undefined ? {} : { onStartAccountLogin })}
            {...(onCancelAccountLogin === undefined ? {} : { onCancelAccountLogin })}
            {...(onConsumeAccountResetCredit === undefined ? {} : { onConsumeAccountResetCredit })}
            {...(onActivateAccountProfile === undefined ? {} : { onActivateAccountProfile })}
            {...(onUpdateAccountProfile === undefined ? {} : { onUpdateAccountProfile })}
            {...(onRemoveAccountProfile === undefined ? {} : { onRemoveAccountProfile })}
          />
          <ServerSoftwareSection
            connection={connection}
            hostUpdate={hostUpdate}
            onApplyHostUpdate={onApplyHostUpdate}
            onApplyRelayUpdate={onApplyRelayUpdate}
            onCheckHostUpdate={onCheckHostUpdate}
            onCheckRelayUpdate={onCheckRelayUpdate}
            relayUpdate={relayUpdate}
          />
        </>
      ),
      description: connectionDescription(
        connectionStateLabel(connection.state, connection.enabled, connection.health),
        hostUpdate,
        relayUpdate,
      ),
      id: connection.id,
      ...(agentProviders === undefined
        ? {}
        : {
            onOpen: () => {
              // Detail-page intent; a failure keeps the last snapshot and its error in the resource.
              agentProviders.refresh(connection.id).catch(() => undefined);
            },
          }),
      leading: <ServerIcon color={colors.text} iconId={connection.iconId} metric="title" />,
      statusIcon:
        connection.enabled && connectionActivity(connection.state, connection.health) !== null ? (
          <ConnectionActivityIndicator
            size={iconSize.indicator}
            status={connection.state}
            {...(connection.health === undefined ? {} : { health: connection.health })}
          />
        ) : (
          <View
            style={[
              styles.connectionStateDot,
              {
                backgroundColor: connection.enabled
                  ? connectionStateColor(connection.state, connection.health)
                  : colors.textDim,
              },
            ]}
          />
        ),
      title: connection.displayName,
    };
  });
}

function connectionDescription(
  state: string,
  host: HostUpdateView | undefined,
  relay: HostUpdateView | undefined,
): string {
  const versions = [updateDescription("Companion", host), updateDescription("Relay", relay)].filter(
    (value): value is string => value !== null,
  );
  return versions.length === 0 ? state : `${state} · ${versions.join(" · ")}`;
}

function updateDescription(label: string, update: HostUpdateView | undefined): string | null {
  if (update === undefined || update.currentVersion === null) {
    return null;
  }
  const available =
    update.latestVersion !== null && update.latestVersion !== update.currentVersion
      ? ` → ${update.latestVersion}`
      : "";
  return `${label} ${update.currentVersion}${available}`;
}
