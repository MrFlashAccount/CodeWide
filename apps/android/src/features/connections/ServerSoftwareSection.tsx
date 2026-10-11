import { View } from "react-native";

import { SettingsGroupHeader } from "../../ui/SettingsGroupHeader";
import type { ConnectionSettingsProps } from "./connectionSettingsContract";
import { styles } from "./ConnectionFeature.styles";
import { HostUpdateSettings } from "./HostUpdateSettings";
import type { HostUpdateView } from "./hostUpdateSettingsContract";

/** Companion and Relay versions of one server, each with its own update state. */
export function ServerSoftwareSection({
  connection,
  hostUpdate,
  onApplyHostUpdate,
  onApplyRelayUpdate,
  onCheckHostUpdate,
  onCheckRelayUpdate,
  relayUpdate,
}: Pick<
  ConnectionSettingsProps,
  "onApplyHostUpdate" | "onApplyRelayUpdate" | "onCheckHostUpdate" | "onCheckRelayUpdate"
> & {
  readonly connection: ConnectionSettingsProps["connections"][number];
  readonly hostUpdate: HostUpdateView | undefined;
  readonly relayUpdate: HostUpdateView | undefined;
}): React.JSX.Element | null {
  // Relay is optional; an unreported Relay version means there is no Relay to show.
  const relay = relayUpdate?.currentVersion === null ? undefined : relayUpdate;
  if (hostUpdate === undefined && relay === undefined) {
    return null;
  }
  return (
    <View style={styles.softwareSection} testID="server-software-settings">
      <SettingsGroupHeader title="Server software" />
      <View style={styles.softwareRows}>
        {hostUpdate !== undefined && (
          <HostUpdateSettings
            connectionId={connection.id}
            connectionName={connection.displayName}
            onApply={onApplyHostUpdate}
            onCheck={onCheckHostUpdate}
            update={hostUpdate}
          />
        )}
        {relay !== undefined && (
          <HostUpdateSettings
            connectionId={connection.id}
            connectionName={connection.displayName}
            onApply={onApplyRelayUpdate}
            onCheck={onCheckRelayUpdate}
            subject="Relay"
            update={relay}
          />
        )}
      </View>
    </View>
  );
}
