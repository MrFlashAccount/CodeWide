import { ActivityIndicator, Platform, View } from "react-native";
import { useEvent } from "../../react/useEvent";
import { colors } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { AppListRow } from "../../ui/AppListRow";
import { AppListRowMenuTrigger } from "../../ui/AppListRowMenuTrigger";
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
  onToggleActions: () => void;
  pending: boolean;
  position: NonNullable<AppListRowProps["position"]>;
  profile: PortForwardingProfile;
  webActionsVisible: boolean;
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
  const primaryTitle = excluded
    ? "Include"
    : live || connecting
      ? "Stop"
      : errored
        ? "Reconnect"
        : "Start";
  const actions: ActionMenuItem[] = [
    {
      icon: excluded
        ? "add-circle-outline"
        : live || connecting
          ? "stop-circle-outline"
          : errored
            ? "refresh-outline"
            : "play-circle-outline",
      id: excluded ? "include" : live || connecting ? "stop" : errored ? "reconnect" : "start",
      label: primaryTitle,
    },
    { icon: "pencil-outline", id: "edit", label: "Edit" },
    { destructive: true, icon: "trash-outline", id: "remove", label: "Remove" },
  ];
  const selectAction = useEvent((id: string): void => {
    if (id === "edit") {
      props.onEdit();
      return;
    }
    if (id === "remove") {
      props.onRemove();
      return;
    }
    primary();
  });
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
              <AppListRowMenuTrigger
                accessibilityLabel={`Forwarding actions ${profile.label}`}
                onPress={props.onToggleActions}
              />
            ) : (
              <ActionMenu
                accessibilityLabel={`Forwarding actions ${profile.label}`}
                actions={actions}
                onSelect={selectAction}
              >
                <AppListRowMenuTrigger accessibilityLabel={`Forwarding actions ${profile.label}`} />
              </ActionMenu>
            )}
          </>
        }
      />
      {Platform.OS === "web" && props.webActionsVisible && (
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
