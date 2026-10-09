import { Ionicons } from "@expo/vector-icons";
import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import {
  nativePortForwardingStore,
  useNativePortForwarding,
} from "../../data/native-port-forwarding-store";
import type { NativePortForwardProfile } from "../../native/native-transport";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AppText } from "../../ui/Typography";
import { styles } from "./BrowserHomePorts.styles";
import { projectBrowserHomePorts } from "./browserHomePortProjection";
import type { PortForwardingCandidate } from "./portForwardingContract";
import { candidateIcon, SectionLabel, ServiceIcon } from "./PortPresentation";

const WIDE_HOME_WIDTH = 600;

/** Home shortcuts subscribe to the existing forwarding owner; they never create or stop forwards. */
export function BrowserHomePorts(props: {
  readonly connectionId: string | null;
  readonly onNavigate: (url: string) => void;
}): React.JSX.Element {
  const snapshot = useNativePortForwarding(props.connectionId);
  const grid$ = useConstant(() => observable(true));
  const grid = useSelector(grid$);
  const wide = useWindowDimensions().width >= WIDE_HOME_WIDTH;
  const toggleLayout = useEvent((): void => {
    grid$.set(!grid$.peek());
  });
  const groups = projectBrowserHomePorts(snapshot, props.connectionId);
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID="browser-home-ports"
    >
      <HomePortsHeader
        grid={grid}
        loading={snapshot.profilesStatus === "loading" || snapshot.discoveryStatus === "loading"}
        onToggle={toggleLayout}
      />
      {snapshot.discoveryStatus === "error" && groups.length > 0 && (
        <AppText accessibilityRole="alert" style={styles.hint}>
          Service categories are unavailable
        </AppText>
      )}
      {groups.length === 0 ? (
        <AppText style={styles.hint}>
          {props.connectionId === null
            ? "Open Browser from a chat to see its server ports"
            : snapshot.profilesStatus === "error"
              ? "Forwarded ports are unavailable"
              : "No forwarded ports yet. Enable a service in Ports."}
        </AppText>
      ) : (
        groups.map((category) => (
          <HomePortCategory
            category={category}
            grid={grid}
            key={category.group}
            onNavigate={props.onNavigate}
            wide={wide}
          />
        ))
      )}
    </ScrollView>
  );
}

function HomePortCategory(props: {
  readonly category: ReturnType<typeof projectBrowserHomePorts>[number];
  readonly grid: boolean;
  readonly onNavigate: (url: string) => void;
  readonly wide: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.category}>
      <SectionLabel value={props.category.group} />
      <View style={styles.services}>
        {props.category.services.map(({ kind, profile }) => (
          <HomeServiceCell
            grid={props.grid}
            key={profile.id}
            kind={kind}
            onNavigate={props.onNavigate}
            profile={profile}
            wide={props.wide}
          />
        ))}
      </View>
    </View>
  );
}

function HomeServiceCell(props: {
  readonly grid: boolean;
  readonly kind: PortForwardingCandidate["kind"];
  readonly onNavigate: (url: string) => void;
  readonly profile: NativePortForwardProfile;
  readonly wide: boolean;
}): React.JSX.Element {
  return (
    <View style={props.grid ? (props.wide ? styles.wideCell : styles.gridCell) : styles.listCell}>
      <HomePort kind={props.kind} onNavigate={props.onNavigate} profile={props.profile} />
    </View>
  );
}

function HomePort(props: {
  readonly kind: PortForwardingCandidate["kind"];
  readonly onNavigate: (url: string) => void;
  readonly profile: NativePortForwardProfile;
}): React.JSX.Element {
  const open = useEvent(() => {
    const current = nativePortForwardingStore
      .scope(props.profile.connectionId)
      .getSnapshot()
      .profiles.find((profile) => profile.id === props.profile.id);
    // Resolve at tap time: an inventory update can revoke a shortcut before React commits its removal.
    if (current?.status === "live" && current.previewUrl !== null) {
      props.onNavigate(current.previewUrl);
    }
  });
  return (
    <Pressable
      accessibilityLabel={`Open ${props.profile.label}, port ${String(props.profile.remotePort)}`}
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => [styles.service, pressed && styles.pressed]}
    >
      <ServiceIcon live name={candidateIcon(props.kind)} />
      <View style={styles.heading}>
        <AppText numberOfLines={1} style={styles.serviceTitle}>
          {props.profile.label}
        </AppText>
        <AppText style={styles.hint}>:{props.profile.remotePort}</AppText>
      </View>
    </Pressable>
  );
}

function HomePortsHeader(props: {
  readonly grid: boolean;
  readonly loading: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.header}>
      <View style={styles.heading}>
        <AppText shimmering={props.loading} style={styles.title}>
          Forwarded ports
        </AppText>
      </View>
      <Pressable
        accessibilityLabel={props.grid ? "Show ports as list" : "Show ports as grid"}
        accessibilityRole="button"
        onPress={props.onToggle}
        style={styles.layoutButton}
      >
        <Ionicons
          color={colors.textMuted}
          name={props.grid ? "list-outline" : "grid-outline"}
          size={iconSize.action}
        />
      </Pressable>
    </View>
  );
}
