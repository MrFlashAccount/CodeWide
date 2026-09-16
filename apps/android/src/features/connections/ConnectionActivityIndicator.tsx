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
  size = 14,
  status,
}: {
  size?: number;
  status: ServerStatus;
}) {
  const activity = connectionActivity(status);
  if (status === "live") {
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
        accessibilityLabel={connectionStateLabel(status)}
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
