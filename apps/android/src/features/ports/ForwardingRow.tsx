import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Platform, Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, type AppListRowProps } from "../../ui/AppListRow.types";
import { AppText as Text } from "../../ui/Typography";
import type { PortForwardingCandidate, PortForwardingProfile } from "./portForwardingContract";
import { hasProfileError } from "./portForwardingList";
import { styles } from "./PortForwardingManager.styles";
import { candidateIcon, ServiceIcon, SmallAction } from "./PortPresentation";

export function ForwardingRow(props: {
  kind: PortForwardingCandidate["kind"];
  onEdit: () => void;
  onInclude: () => void;
  onOpen: () => void;
  onReconnect: () => void;
  onRemove: () => void;
  onStart: () => void;
  onStop: () => void;
  onToggleWebMenu: () => void;
  pending: boolean;
  position: NonNullable<AppListRowProps["position"]>;
  profile: PortForwardingProfile;
  webMenuVisible: boolean;
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
      icon: live || connecting ? "stop-circle-outline" : "play-circle-outline",
      id: primaryId,
      label: primaryTitle,
    },
    { icon: "pencil-outline", id: "edit", label: "Edit" },
    { destructive: true, icon: "trash-outline", id: "remove", label: "Remove" },
  ];
  const onAction = (id: string) => {
    if (id === "edit") {
      props.onEdit();
    } else if (id === "remove") {
      props.onRemove();
    } else {
      primary();
    }
  };
  return (
    <View testID={`forwarding-profile-${profile.id}`}>
      <AppListRow
        accessibilityLabel={`${profile.label}, ${status}`}
        description={`:${String(profile.remotePort)} → phone :${String(profile.localPort ?? "auto")} · ${status}`}
        fixedHeight={listRowHeight.double}
        leading={<ServiceIcon live={live} name={candidateIcon(props.kind)} />}
        onPress={live ? props.onOpen : props.onEdit}
        position={props.position}
        title={profile.label}
        trailing={
          <>
            {(connecting || props.pending) && <ActivityIndicator color={color} size="small" />}
            {Platform.OS === "web" ? (
              <Pressable
                accessibilityLabel={`Forwarding actions ${profile.label}`}
                accessibilityRole="button"
                onPress={props.onToggleWebMenu}
                style={styles.iconButton}
              >
                <Ionicons color={colors.textDim} name="ellipsis-vertical" size={iconSize.action} />
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
                    color={colors.textDim}
                    name="ellipsis-vertical"
                    size={iconSize.action}
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
            onPress={primary}
            title={primaryTitle}
          />
          <SmallAction label={`Edit ${profile.label}`} onPress={props.onEdit} title="Edit" />
          <SmallAction
            danger
            label={`Remove ${profile.label}`}
            onPress={props.onRemove}
            title="Remove"
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
