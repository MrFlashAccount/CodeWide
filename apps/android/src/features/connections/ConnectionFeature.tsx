/** V1 SettingsFeature owner, extracted without changing interaction or resource lifetime. */
import { Platform, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { ConnectionActivityIndicator } from "./ConnectionActivityIndicator";
import { styles } from "./ConnectionFeature.styles";
import {
  connectionActivity,
  connectionStateColor,
  connectionStateLabel,
} from "./connectionPresentation";
import { ConnectionRowEditor } from "./ConnectionRowEditor";

import type { ConnectionSettingsProps } from "./connectionSettingsContract";

/** Presents qualified server status and editors through the public settings capability. */
export function connectionSettingsSections({
  connections,
  accountRateLimits,
  onToggle,
  onReconnect,
  onDelete,
  onUpdate,
  onMove,
  onRefreshAccountPool,
  onStartAccountLogin,
  onCancelAccountLogin,
  onActivateAccountProfile,
  onUpdateAccountProfile,
  onRemoveAccountProfile,
}: ConnectionSettingsProps) {
  return connections.map((connection) => ({
    id: connection.id,
    title: connection.displayName,
    description: connectionStateLabel(connection.state, connection.enabled),
    leading: (
      <Text style={styles.serverEmoji}>
        {Platform.OS === "web"
          ? connection.displayName.slice(0, 1).toLocaleUpperCase()
          : connection.emoji}
      </Text>
    ),
    statusIcon:
      connection.enabled && connectionActivity(connection.state) !== null ? (
        <ConnectionActivityIndicator status={connection.state} size={iconSize.indicator} />
      ) : (
        <View
          style={[
            styles.connectionStateDot,
            {
              backgroundColor: connection.enabled
                ? connectionStateColor(connection.state)
                : colors.textDim,
            },
          ]}
        />
      ),
    content: (
      <ConnectionRowEditor
        connection={connection}
        onToggle={onToggle}
        onReconnect={onReconnect}
        onDelete={onDelete}
        onUpdate={onUpdate}
        onMove={onMove}
        accountPool={
          accountRateLimits.find((row) => row.connectionId === connection.id)?.accountPool ?? null
        }
        {...(onRefreshAccountPool === undefined ? {} : { onRefreshAccountPool })}
        {...(onStartAccountLogin === undefined ? {} : { onStartAccountLogin })}
        {...(onCancelAccountLogin === undefined ? {} : { onCancelAccountLogin })}
        {...(onActivateAccountProfile === undefined ? {} : { onActivateAccountProfile })}
        {...(onUpdateAccountProfile === undefined ? {} : { onUpdateAccountProfile })}
        {...(onRemoveAccountProfile === undefined ? {} : { onRemoveAccountProfile })}
      />
    ),
  }));
}
