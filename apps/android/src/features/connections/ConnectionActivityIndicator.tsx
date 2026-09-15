/** V1 ConnectionActivityIndicator owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, View } from "react-native";
import { styles } from "./ConnectionActivityIndicator.styles";
import {
  type ServerStatus,
  connectionActivity,
  connectionActivityColor,
  connectionStateColor,
  connectionStateLabel,
} from "./connectionPresentation";

export function ConnectionActivityIndicator({
  status,
  size = 14,
}: {
  status: ServerStatus;
  size?: number;
}) {
  const activity = connectionActivity(status);
  if (status === "live") return null;
  if (activity === null) {
    const icon =
      status === "offline"
        ? "cloud-offline-outline"
        : status === "authRequired"
          ? "key-outline"
          : "alert-circle-outline";
    return (
      <View
        accessible
        accessibilityLabel={connectionStateLabel(status)}
        style={styles.connectionActivityIndicator}
      >
        <Ionicons name={icon} size={size} color={connectionStateColor(status)} />
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={activity === "connecting" ? "Connecting" : "Updating"}
      style={styles.connectionActivityIndicator}
    >
      <ActivityIndicator size={size} color={connectionActivityColor(activity)} />
    </View>
  );
}
