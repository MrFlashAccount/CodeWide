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
import { ServerIcon } from "./ServerIcon";

import type { ConnectionSettingsProps } from "./connectionSettingsContract";

/** Presents qualified server status and editors through the public settings capability. */
export function connectionSettingsSections({
  accountRateLimits,
  connections,
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
}: ConnectionSettingsProps) {
  return connections.map((connection) => ({
    content: (
      <ConnectionRowEditor
        accountPool={
          accountRateLimits.find((row) => row.connectionId === connection.id)?.accountPool ?? null
        }
        connection={connection}
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
    ),
    description: connectionStateLabel(connection.state, connection.enabled, connection.health),
    id: connection.id,
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
  }));
}
