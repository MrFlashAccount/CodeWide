/** V1 ConnectionActivityIndicator owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, View } from "react-native";
import { styles } from "./ConnectionActivityIndicator.styles";
import type { ConnectionHealthStatus } from "../../data/connectionHealth";
import {
  type ServerStatus,
  connectionActivity,
  connectionActivityColor,
  connectionStateColor,
  connectionStateLabel,
} from "./connectionPresentation";

export function ConnectionActivityIndicator({
  health,
  size = 14,
  status,
}: {
  health?: ConnectionHealthStatus | undefined;
  size?: number;
  status: ServerStatus;
}) {
  const activity = connectionActivity(status, health);
  const live = health === undefined ? status === "live" : health === "online";
  if (live) {
    return null;
  }
  if (activity === null) {
    const icon =
      status === "offline"
        ? "cloud-offline-outline"
        : status === "authRequired"
          ? "key-outline"
          : "alert-circle-outline";
    return (
      <View
        accessibilityLabel={connectionStateLabel(status, true, health)}
        accessible
        style={styles.connectionActivityIndicator}
      >
        <Ionicons color={connectionStateColor(status)} name={icon} size={size} />
      </View>
    );
  }
  return (
    <View
      accessibilityLabel={activity === "connecting" ? "Connecting" : "Updating"}
      accessible
      style={styles.connectionActivityIndicator}
    >
      <ActivityIndicator color={connectionActivityColor(activity)} size={size} />
    </View>
  );
}
