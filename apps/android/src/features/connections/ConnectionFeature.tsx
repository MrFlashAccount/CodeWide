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
  accountRateLimits,
  connections,
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
}: ConnectionSettingsProps) {
  return connections.map((connection) => ({
    content: (
      <ConnectionRowEditor
        accountPool={
          accountRateLimits.find((row) => row.connectionId === connection.id)?.accountPool ?? null
        }
        connection={connection}
        onDelete={onDelete}
        onMove={onMove}
        onReconnect={onReconnect}
        onToggle={onToggle}
        onUpdate={onUpdate}
        {...(onRefreshAccountPool === undefined ? {} : { onRefreshAccountPool })}
        {...(onStartAccountLogin === undefined ? {} : { onStartAccountLogin })}
        {...(onCancelAccountLogin === undefined ? {} : { onCancelAccountLogin })}
        {...(onActivateAccountProfile === undefined ? {} : { onActivateAccountProfile })}
        {...(onUpdateAccountProfile === undefined ? {} : { onUpdateAccountProfile })}
        {...(onRemoveAccountProfile === undefined ? {} : { onRemoveAccountProfile })}
      />
    ),
    description: connectionStateLabel(connection.state, connection.enabled),
    id: connection.id,
    leading: (
      <Text style={styles.serverEmoji}>
        {Platform.OS === "web"
          ? connection.displayName.slice(0, 1).toLocaleUpperCase()
          : connection.emoji}
      </Text>
    ),
    statusIcon:
      connection.enabled && connectionActivity(connection.state) !== null ? (
        <ConnectionActivityIndicator size={iconSize.indicator} status={connection.state} />
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
    title: connection.displayName,
  }));
}
