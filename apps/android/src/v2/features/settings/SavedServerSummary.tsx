import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import type { SavedServerConnection } from "../../application/ports/savedServerRepository";
import type { ServerConnectionStatus } from "../../application/resources/serverConnectionStatusesResource";
import type { SavedServer } from "../../domain/savedServer";
import {
  connectionStateColor,
  connectionStateLabel,
  isActiveConnectionState,
} from "../../presentation/settings/connectionStatusPresentation";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { AsyncActionFeedbackView } from "../../presentation/actions/AsyncActionFeedbackView";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { SavedServerDeleteConfirmation } from "./SavedServerDeleteConfirmation";

interface SavedServerSummaryProps {
  actions: ActionMenuItem[];
  confirmingDelete: boolean;
  connection: SavedServerConnection;
  error: string | null;
  onAction(id: string): void;
  onCancelDelete(): void;
  onConfirmDelete(): void;
  onRetryError?(): void;
  onToggle(enabled: boolean): void;
  pending: boolean;
  server: SavedServer;
  status: ServerConnectionStatus;
}

export function SavedServerSummary(props: SavedServerSummaryProps): React.JSX.Element {
  const {
    actions,
    confirmingDelete,
    connection,
    error,
    onAction,
    onCancelDelete,
    onConfirmDelete,
    onRetryError,
    onToggle,
    pending,
    server,
    status,
  } = props;
  const color = connectionStateColor(status.state);
  const connected = status.state === "connected";
  return (
    <View style={styles.serverEditor}>
      <View style={styles.serverRow}>
        <Text style={styles.serverEmoji}>{server.emoji}</Text>
        <View style={styles.serverText}>
          <Text numberOfLines={1} style={styles.serverName}>
            {server.displayName}
          </Text>
          <View style={styles.endpointRow} testID="saved-server-endpoint-row">
            {connected ? (
              <Ionicons
                accessibilityLabel="Secure connection"
                color={colors.green}
                name="lock-closed"
                size={13}
              />
            ) : null}
            <Text ellipsizeMode="middle" numberOfLines={1} style={styles.serverEndpoint}>
              {connection.endpoint}
            </Text>
          </View>
          {connected ? null : (
            <View style={styles.stateRow}>
              {isActiveConnectionState(status.state) ? (
                <ShimmerText
                  style={[styles.stateText, { color }]}
                  text={connectionStateLabel(status.state)}
                />
              ) : (
                <>
                  <View style={[styles.stateDot, { backgroundColor: color }]} />
                  <Text style={[styles.stateText, { color }]}>
                    {connectionStateLabel(status.state)}
                  </Text>
                </>
              )}
            </View>
          )}
          {status.detail === null ? null : (
            <Text accessibilityLiveRegion="polite" selectable style={styles.diagnostic}>
              {status.detail}
            </Text>
          )}
        </View>
        {pending ? <ShimmerText style={styles.pendingText} text="Updating" /> : null}
        <Switch
          accessibilityLabel={`Enable ${server.displayName}`}
          disabled={pending}
          onValueChange={onToggle}
          value={connection.enabled}
        />
        <ActionMenu
          accessibilityLabel={`Actions for ${server.displayName}`}
          actions={actions}
          onSelect={onAction}
          style={styles.menuAnchor}
        >
          <Pressable
            accessibilityLabel={`Actions for ${server.displayName}`}
            style={styles.iconButton}
          >
            <Ionicons color={colors.textMuted} name="ellipsis-horizontal" size={20} />
          </Pressable>
        </ActionMenu>
      </View>
      {error === null ? null : (
        <AsyncActionFeedbackView
          error={error}
          {...(onRetryError === undefined ? {} : { onRetry: onRetryError })}
          pending={false}
          pendingLabel="Updating server…"
        />
      )}
      {confirmingDelete ? (
        <SavedServerDeleteConfirmation
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
          pending={pending}
          serverName={server.displayName}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  diagnostic: { color: colors.red, ...typeScale.caption, marginTop: spacing.optical },
  endpointRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  menuAnchor: { height: touchTarget, width: touchTarget },
  pendingText: { color: colors.textMuted, ...typeScale.caption },
  serverEditor: { borderBottomColor: colors.borderSoft, borderBottomWidth: 1 },
  serverEmoji: typeScale.emoji,
  serverEndpoint: { color: colors.textMuted, ...typeScale.label, flex: 1, minWidth: 0 },
  serverName: { color: colors.text, ...typeScale.title },
  serverRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 72,
    paddingVertical: spacing.xs,
  },
  serverText: { flex: 1, minWidth: 0 },
  stateDot: { borderRadius: 4, height: 7, width: 7 },
  stateRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xxs,
    minHeight: 18,
  },
  stateText: { ...typeScale.caption, fontWeight: typeWeight.semibold },
});
