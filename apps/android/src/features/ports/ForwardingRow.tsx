import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, type AppListRowProps } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import { type PortForwardingCandidate, type PortForwardingProfile } from "./portForwardingContract";
import { hasProfileError } from "./portForwardingList";
import { styles } from "./PortForwardingManager.styles";
import { candidateIcon, ServiceIcon, SmallAction } from "./PortPresentation";
export function ForwardingRow(props: {
  profile: PortForwardingProfile;
  kind: PortForwardingCandidate["kind"];
  position: NonNullable<AppListRowProps["position"]>;
  pending: boolean;
  webMenuVisible: boolean;
  onToggleWebMenu(): void;
  onEdit(): void;
  onOpen(): void;
  onStart(): void;
  onStop(): void;
  onReconnect(): void;
  onRemove(): void;
  onInclude(): void;
}) {
  const { profile } = props;
  const live = profile.status === "live";
  const connecting = profile.status === "connecting";
  const unavailable = profile.status === "unavailable";
  const errored = profile.status === "error";
  const excluded = profile.preference === "excluded";
  const status = props.pending
    ? "Updating"
    : excluded
      ? "Excluded"
      : live
        ? "Live"
        : unavailable
          ? "Unavailable"
          : errored
            ? "Error"
            : connecting
              ? "Connecting"
              : "Stopped";
  const color = live
    ? colors.green
    : unavailable || connecting
      ? colors.amber
      : errored
        ? colors.red
        : colors.textDim;
  const primary = excluded
    ? props.onInclude
    : live || connecting
      ? props.onStop
      : errored
        ? props.onReconnect
        : props.onStart;
  const primaryId = excluded
    ? "include"
    : live || connecting
      ? "stop"
      : errored
        ? "reconnect"
        : "start";
  const primaryTitle = excluded
    ? "Include"
    : live || connecting
      ? "Stop"
      : errored
        ? "Reconnect"
        : "Start";
  const actions: ActionMenuItem[] = [
    {
      id: primaryId,
      label: primaryTitle,
      icon: live || connecting ? "stop-circle-outline" : "play-circle-outline",
    },
    { id: "edit", label: "Edit", icon: "pencil-outline" },
    { id: "remove", label: "Remove", icon: "trash-outline", destructive: true },
  ];
  const onAction = (id: string) => {
    if (id === "edit") props.onEdit();
    else if (id === "remove") props.onRemove();
    else primary();
  };
  return (
    <View testID={`forwarding-profile-${profile.id}`}>
      <AppListRow
        title={profile.label}
        description={`:${profile.remotePort} → phone :${profile.localPort ?? "auto"} · ${status}`}
        accessibilityLabel={`${profile.label}, ${status}`}
        onPress={live ? props.onOpen : props.onEdit}
        fixedHeight={listRowHeight.double}
        position={props.position}
        leading={<ServiceIcon name={candidateIcon(props.kind)} live={live} />}
        trailing={
          <>
            {(connecting || props.pending) && <ActivityIndicator size="small" color={color} />}
            {Platform.OS === "web" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Forwarding actions ${profile.label}`}
                onPress={props.onToggleWebMenu}
                style={styles.iconButton}
              >
                <Ionicons name="ellipsis-vertical" size={iconSize.action} color={colors.textDim} />
              </Pressable>
            ) : (
              <ActionMenu
                accessibilityLabel={`Forwarding actions ${profile.label}`}
                actions={actions}
                onSelect={onAction}
                style={styles.menuAnchor}
              >
                <Pressable
                  accessibilityLabel={`Forwarding actions ${profile.label}`}
                  style={styles.iconButton}
                >
                  <Ionicons
                    name="ellipsis-vertical"
                    size={iconSize.action}
                    color={colors.textDim}
                  />
                </Pressable>
              </ActionMenu>
            )}
          </>
        }
      />
      {Platform.OS === "web" && props.webMenuVisible && (
        <View style={styles.webActions}>
          <SmallAction
            label={`${primaryTitle} ${profile.label}`}
            title={primaryTitle}
            onPress={primary}
          />
          <SmallAction label={`Edit ${profile.label}`} title="Edit" onPress={props.onEdit} />
          <SmallAction
            label={`Remove ${profile.label}`}
            title="Remove"
            onPress={props.onRemove}
            danger
          />
        </View>
      )}
      {hasProfileError(profile) && (
        <View style={styles.profileErrorCell}>
          <Text
            numberOfLines={2}
            style={[styles.profileError, unavailable && styles.profileUnavailable]}
          >
            {profile.error}
          </Text>
        </View>
      )}
    </View>
  );
}
