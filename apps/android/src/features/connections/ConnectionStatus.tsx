/** V1 ConnectionRowEditor owner, extracted without changing interaction or resource lifetime. */
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import type { StoredConnection } from "../../data/connection-profile-types";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { ConnectionActivityIndicator } from "./ConnectionActivityIndicator";
import {
  connectionActivity,
  connectionDiagnosticSummary,
  connectionDiagnosticTime,
  connectionStateColor,
  connectionStateLabel,
} from "./connectionPresentation";
import { styles } from "./ConnectionRowEditor.styles";

export function ConnectionStatus({
  connection,
  secureLive,
  diagnosticExpanded,
  setDiagnosticExpanded,
  copyDiagnostic,
}: {
  connection: StoredConnection;
  secureLive: boolean;
  diagnosticExpanded: boolean;
  setDiagnosticExpanded: (update: (value: boolean) => boolean) => void;
  copyDiagnostic(): Promise<void>;
}) {
  return (
    <>
      {!secureLive && (
        <View style={styles.connectionStateRow}>
          <View style={styles.connectionStateIcon}>
            {connection.enabled && connectionActivity(connection.state) !== null ? (
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
            )}
          </View>
          <Text
            numberOfLines={1}
            style={[
              styles.connectionStateText,
              {
                color: connection.enabled ? connectionStateColor(connection.state) : colors.textDim,
              },
            ]}
          >
            {connectionStateLabel(connection.state, connection.enabled)}
          </Text>
        </View>
      )}
      {connection.lastError !== null && connection.state !== "live" && (
        <View style={styles.connectionDiagnostic}>
          <View style={styles.connectionDiagnosticHeader}>
            <Ionicons name="warning-outline" size={iconSize.inline} color={colors.red} />
            <Text selectable style={styles.connectionDiagnosticSummary}>
              {connectionDiagnosticSummary(connection.lastError)}
            </Text>
          </View>
          <View style={styles.connectionDiagnosticMeta}>
            {connection.lastErrorAt !== null && (
              <Text style={styles.connectionDiagnosticTime}>
                {connectionDiagnosticTime(connection.lastErrorAt)}
              </Text>
            )}
            <Pressable
              accessibilityLabel={`${diagnosticExpanded ? "Hide" : "Show"} error details for ${connection.displayName}`}
              onPress={() => setDiagnosticExpanded((value) => !value)}
            >
              <Text style={styles.rawLink}>
                {diagnosticExpanded ? "Hide details" : "Error details"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Copy error for ${connection.displayName}`}
              onPress={() => void copyDiagnostic()}
            >
              <Text style={styles.rawLink}>Copy</Text>
            </Pressable>
          </View>
          {diagnosticExpanded && (
            <Text selectable style={styles.connectionDiagnosticRaw}>
              {connection.lastError}
            </Text>
          )}
        </View>
      )}
    </>
  );
}
