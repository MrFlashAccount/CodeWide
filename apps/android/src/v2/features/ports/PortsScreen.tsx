import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { V2PortDescriptor } from "@codewide/sync-client/v2";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import type { PortProfile, PortsResource } from "../../application/resources/portsResource";
import {
  PresentationSheetView,
  type PresentationSheetContentProps,
} from "../../presentation/surfaces/PresentationSheetView";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { useEvent } from "../../../react/useEvent";
import {
  colors,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
  typeTracking,
} from "../../theme";
import { portBrowserDestination, portDestination } from "../navigation/routeDestinations";
import { VoiceTextInput } from "../conversation/VoiceTextInput";

interface PortsScreenProps {
  savedServerId: SavedServerId;
}

interface PortRowProps {
  onError(message: string | null): void;
  port: V2PortDescriptor;
  resource: PortsResource;
}

interface ProfileRowProps {
  kind: string;
  onError(message: string | null): void;
  profile: PortProfile;
  resource: PortsResource;
  savedServerId: SavedServerId;
}

type ServiceSegment = "active" | "available" | "excluded";

interface SegmentButtonProps {
  count: number;
  label: string;
  onPress(): void;
  selected: boolean;
}

interface InfoRowProps {
  loading?: boolean;
  subtitle: string;
  title: string;
}

export function PortsScreen(props: PortsScreenProps): React.JSX.Element {
  const { savedServerId } = props;
  const runtime = useV2Runtime();
  const [resource] = useState(() => runtime.ports(savedServerId));
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const [segment, setSegment] = useState<ServiceSegment>("active");
  const [query, setQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const serverName =
    servers.value.find((server) => server.id === savedServerId)?.displayName ?? "Server";
  const needle = query.trim().toLocaleLowerCase();
  const configuredKeys = new Set(
    snapshot.value.profiles.flatMap((profile) =>
      profile.forwardingKey === null ? [] : [profile.forwardingKey],
    ),
  );
  const configuredPorts = new Set(snapshot.value.profiles.map((profile) => profile.port));
  const available = snapshot.value.ports.filter(
    (port) => !configuredKeys.has(port.forwardingKey) && !configuredPorts.has(port.port),
  );
  const activeProfiles = snapshot.value.profiles.filter(
    (profile) => profile.preference !== "excluded",
  );
  const excludedProfiles = snapshot.value.profiles.filter(
    (profile) => profile.preference === "excluded",
  );
  const filteredPorts = available.filter((port) => matches(port, needle));
  const filteredProfiles = (
    segment === "active" ? activeProfiles : segment === "excluded" ? excludedProfiles : []
  ).filter((profile) =>
    profileMatches(profile, profileCandidate(profile, snapshot.value.ports), needle),
  );
  const refresh = useEvent(() => {
    void resource.refresh().catch(() => undefined);
  });
  const clear = useEvent(() => setQuery(""));
  const showActive = useEvent(() => setSegment("active"));
  const showAvailable = useEvent(() => setSegment("available"));
  const showExcluded = useEvent(() => setSegment("excluded"));
  const close = useEvent(() => router.back());
  const changeOpen = useEvent((open: boolean) => {
    if (!open) close();
  });

  return (
    <PresentationSheetView contentProps={PORTS_SHEET_PROPS} isOpen onOpenChange={changeOpen}>
      <View testID="v2-port-forwarding-manager" style={styles.root}>
        <View style={styles.header}>
          <View style={styles.titleBlock}>
            {snapshot.status === "loading" ? (
              <ShimmerText style={styles.title} text="Ports" />
            ) : (
              <Text style={styles.title}>Ports</Text>
            )}
            <Text numberOfLines={1} style={styles.subtitle}>
              {serverName}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Refresh open ports"
            accessibilityRole="button"
            disabled={snapshot.value.discoveryStatus === "loading"}
            onPress={refresh}
            style={styles.iconButton}
          >
            <Ionicons color={colors.textMuted} name="refresh" size={19} />
          </Pressable>
          <Pressable accessibilityLabel="Close ports" onPress={close} style={styles.iconButton}>
            <Ionicons color={colors.text} name="close" size={21} />
          </Pressable>
        </View>
        <View style={styles.filters}>
          <View accessibilityRole="tablist" style={styles.segments}>
            <SegmentButton
              count={activeProfiles.length}
              label="Active"
              onPress={showActive}
              selected={segment === "active"}
            />
            <SegmentButton
              count={available.length}
              label="Available"
              onPress={showAvailable}
              selected={segment === "available"}
            />
            <SegmentButton
              count={excludedProfiles.length}
              label="Excluded"
              onPress={showExcluded}
              selected={segment === "excluded"}
            />
          </View>
          <View style={styles.searchField}>
            <Ionicons color={colors.textDim} name="search" size={16} />
            <VoiceTextInput
              accessibilityLabel="Filter ports"
              audience={savedServerId}
              onChangeText={setQuery}
              placeholder="Name, category or port"
              placeholderTextColor={colors.textDim}
              scope={{ id: `port-filter:${savedServerId}`, kind: "generic" }}
              style={styles.searchInput}
              thread={null}
              value={query}
            />
            {query === "" ? null : (
              <Pressable accessibilityLabel="Clear port filter" onPress={clear}>
                <Ionicons color={colors.textDim} name="close-circle" size={16} />
              </Pressable>
            )}
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {actionError === null ? null : (
            <Text style={styles.error} testID="v2-port-action-error">
              {actionError}
            </Text>
          )}
          {snapshot.value.profileError === null ? null : (
            <Text style={styles.error} testID="v2-port-profile-error">
              {snapshot.value.profileError}
            </Text>
          )}
          {snapshot.value.discoveryStatus === "loading" && snapshot.value.ports.length === 0 ? (
            <InfoRow
              loading
              subtitle="Reading localhost listeners"
              title="Looking for open ports…"
            />
          ) : snapshot.value.discoveryStatus === "error" && snapshot.value.ports.length === 0 ? (
            <InfoRow
              subtitle={snapshot.value.discoveryError ?? "Tap refresh to try again"}
              title="Could not scan ports"
            />
          ) : segment === "active" && filteredProfiles.length === 0 ? (
            <InfoRow
              subtitle="Include a discovered service or add a port manually"
              title="No active ports"
            />
          ) : segment === "active" ? (
            filteredProfiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                kind={profileCandidate(profile, snapshot.value.ports)?.kind ?? "process"}
                onError={setActionError}
                profile={profile}
                resource={resource}
                savedServerId={savedServerId}
              />
            ))
          ) : segment === "excluded" && filteredProfiles.length === 0 ? (
            <InfoRow
              subtitle={
                query === ""
                  ? "Services you exclude will appear here"
                  : "Try another name, category or port"
              }
              title="No excluded ports"
            />
          ) : segment === "excluded" ? (
            filteredProfiles.map((profile) => (
              <ProfileRow
                key={profile.id}
                kind={profileCandidate(profile, snapshot.value.ports)?.kind ?? "process"}
                onError={setActionError}
                profile={profile}
                resource={resource}
                savedServerId={savedServerId}
              />
            ))
          ) : filteredPorts.length === 0 ? (
            <InfoRow
              subtitle={
                query === ""
                  ? "Every discovered service is active or excluded"
                  : "Try another name, category or port"
              }
              title="No available ports"
            />
          ) : (
            groupPorts(filteredPorts).map((group) => (
              <View key={group.name}>
                <Text style={styles.sectionLabel}>{group.name}</Text>
                {group.ports.map((port) => (
                  <PortRow
                    key={port.forwardingKey}
                    onError={setActionError}
                    port={port}
                    resource={resource}
                  />
                ))}
              </View>
            ))
          )}
          {segment === "available" && query === "" ? (
            <>
              <BoundedPreviewRow savedServerId={savedServerId} />
              <ManualPortRow savedServerId={savedServerId} />
            </>
          ) : null}
        </ScrollView>
      </View>
    </PresentationSheetView>
  );
}

const PORTS_SHEET_PROPS: PresentationSheetContentProps = {
  contentContainerClassName: "h-full",
  enableDynamicSizing: false,
  enableOverDrag: false,
  index: 0,
  snapPoints: ["55%", "90%"],
};

function SegmentButton(props: SegmentButtonProps): React.JSX.Element {
  const { count, label, onPress, selected } = props;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.segment, selected && styles.segmentSelected]}
    >
      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
        {label} {count}
      </Text>
    </Pressable>
  );
}

function PortRow(props: PortRowProps): React.JSX.Element {
  const { onError, port, resource } = props;
  const [pending, startAction] = useTransition();
  const open = useEvent(() => {
    const label = port.name === "" ? `Port ${port.port}` : port.name;
    onError(null);
    startAction(async () => {
      try {
        await resource.create({
          forwardingKey: port.forwardingKey,
          label,
          port: port.port,
          preferredLocalPort: null,
          profileId: null,
          start: true,
        });
      } catch (cause) {
        onError(message(cause, "Could not forward this port"));
      }
    });
  });
  const exclude = useEvent(() => {
    onError(null);
    startAction(async () => {
      try {
        await resource.exclude(port);
      } catch (cause) {
        onError(message(cause, "Could not exclude this port"));
      }
    });
  });
  const detail = port.cwd ?? port.process;
  return (
    <View style={styles.serviceRow}>
      <Pressable
        accessibilityLabel={`Forward ${port.name} port ${port.port}`}
        accessibilityRole="button"
        disabled={pending}
        onPress={open}
        style={styles.rowMain}
      >
        <View style={styles.serviceIcon}>
          <Ionicons color={colors.textMuted} name={portIcon(port.kind)} size={19} />
        </View>
        <View style={styles.rowText}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {port.name === "" ? `Port ${port.port}` : port.name}
          </Text>
          <Text ellipsizeMode="middle" numberOfLines={1} style={styles.rowSubtitle}>
            :{port.port}
            {detail === null ? "" : ` · ${shortPath(detail)}`}
          </Text>
        </View>
        {pending ? (
          <ShimmerText style={styles.rowSubtitle} text="Adding" />
        ) : (
          <Ionicons color={colors.textMuted} name="add" size={20} />
        )}
      </Pressable>
      {pending ? null : (
        <Pressable
          accessibilityLabel={`Exclude ${port.name}`}
          onPress={exclude}
          style={styles.rowAction}
        >
          <Ionicons color={colors.textDim} name="ban-outline" size={18} />
        </Pressable>
      )}
    </View>
  );
}

function ProfileRow(props: ProfileRowProps): React.JSX.Element {
  const { kind, onError, profile, resource, savedServerId } = props;
  const [pending, startAction] = useTransition();
  const open = useEvent(() =>
    router.push(
      profile.status === "live"
        ? portBrowserDestination(savedServerId, profile.id)
        : portDestination(savedServerId, profile.id),
    ),
  );
  const edit = useEvent(() => router.push(portDestination(savedServerId, profile.id)));
  const toggle = useEvent(() => {
    const update =
      profile.status === "live" || profile.status === "connecting"
        ? () => resource.stop(profile.id)
        : profile.status === "error"
          ? () => resource.reconnect(profile.id)
          : () => resource.start(profile.id);
    onError(null);
    startAction(async () => {
      try {
        await update();
      } catch (cause) {
        onError(message(cause, "Could not update port forwarding"));
      }
    });
  });
  return (
    <View style={styles.serviceRow}>
      <Pressable
        accessibilityLabel={`${profile.label}, ${profile.status}`}
        onPress={open}
        style={styles.rowMain}
      >
        <View style={styles.serviceIcon}>
          <Ionicons color={colors.textMuted} name={portIcon(kind)} size={19} />
          {profile.status === "live" ? <View style={styles.liveDot} /> : null}
        </View>
        <View style={styles.rowText}>
          <View style={styles.rowTitleLine}>
            <Text numberOfLines={1} style={styles.rowTitle}>
              {profile.label}
            </Text>
            <Text style={[styles.status, profile.status === "live" && styles.statusLive]}>
              {pending ? "Updating" : profile.status}
            </Text>
          </View>
          <Text style={styles.rowSubtitle}>
            :{profile.port} → phone :{profile.localPort ?? "auto"}
          </Text>
          {profile.error === null ? null : (
            <Text numberOfLines={2} style={styles.profileError}>
              {profile.error}
            </Text>
          )}
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={`Edit ${profile.label}`}
        onPress={edit}
        style={styles.rowAction}
      >
        <Ionicons color={colors.textMuted} name="create-outline" size={18} />
      </Pressable>
      <Pressable
        accessibilityLabel={`${profile.status === "live" || profile.status === "connecting" ? "Stop" : "Start"} ${profile.label}`}
        onPress={toggle}
        style={styles.rowAction}
      >
        <Ionicons
          color={colors.textMuted}
          name={profile.status === "live" ? "stop-circle-outline" : "play-circle-outline"}
          size={20}
        />
      </Pressable>
    </View>
  );
}

interface ManualPortRowProps {
  savedServerId: SavedServerId;
}

function ManualPortRow(props: ManualPortRowProps): React.JSX.Element {
  const { savedServerId } = props;
  const open = useEvent(() => router.push(portDestination(savedServerId, "manual")));
  return (
    <Pressable accessibilityLabel="Port not listed" onPress={open} style={styles.serviceRow}>
      <View style={styles.serviceIcon}>
        <Ionicons color={colors.textMuted} name="keypad-outline" size={19} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>Port not listed</Text>
        <Text style={styles.rowSubtitle}>Enter a localhost port manually</Text>
      </View>
      <Ionicons color={colors.textDim} name="chevron-forward" size={17} />
    </Pressable>
  );
}

function BoundedPreviewRow(props: ManualPortRowProps): React.JSX.Element {
  const { savedServerId } = props;
  const open = useEvent(() => router.push(portDestination(savedServerId, "tunnel")));
  return (
    <Pressable
      accessibilityLabel="Open bounded localhost preview"
      onPress={open}
      style={styles.serviceRow}
    >
      <View style={styles.serviceIcon}>
        <Ionicons color={colors.textMuted} name="globe-outline" size={19} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>Bounded localhost preview</Text>
        <Text style={styles.rowSubtitle}>Temporary browser tunnel through secure transport</Text>
      </View>
      <Ionicons color={colors.textDim} name="chevron-forward" size={17} />
    </Pressable>
  );
}

function InfoRow(props: InfoRowProps): React.JSX.Element {
  const { loading = false, subtitle, title } = props;
  return (
    <View style={styles.serviceRow}>
      {loading ? null : (
        <View style={styles.serviceIcon}>
          <Ionicons color={colors.textMuted} name="information-circle-outline" size={19} />
        </View>
      )}
      <View style={styles.rowText}>
        {loading ? (
          <ShimmerText containerStyle={styles.rowShimmer} style={styles.rowTitle} text={title} />
        ) : (
          <Text style={styles.rowTitle}>{title}</Text>
        )}
        <Text numberOfLines={2} style={styles.rowSubtitle}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

interface PortGroup {
  name: string;
  ports: V2PortDescriptor[];
}

function groupPorts(ports: V2PortDescriptor[]): PortGroup[] {
  const groups = new Map<string, V2PortDescriptor[]>();
  for (const port of ports) {
    const current = groups.get(port.group);
    if (current === undefined) groups.set(port.group, [port]);
    else current.push(port);
  }
  const result: PortGroup[] = [];
  for (const entry of groups) {
    const [name, values] = entry;
    result.push({ name, ports: values });
  }
  return result;
}

function matches(port: V2PortDescriptor, needle: string): boolean {
  if (needle === "") return true;
  return [port.name, port.group, port.details, port.kind, String(port.port)].some((value) =>
    value.toLocaleLowerCase().includes(needle),
  );
}

function profileMatches(
  profile: PortProfile,
  candidate: V2PortDescriptor | undefined,
  needle: string,
): boolean {
  if (needle === "") return true;
  return [
    profile.label,
    candidate?.group ?? "Saved ports",
    candidate?.kind ?? "process",
    String(profile.port),
  ].some((value) => value.toLocaleLowerCase().includes(needle));
}

function profileCandidate(
  profile: PortProfile,
  ports: V2PortDescriptor[],
): V2PortDescriptor | undefined {
  return ports.find(
    (port) => port.forwardingKey === profile.forwardingKey || port.port === profile.port,
  );
}

function portIcon(kind: string): keyof typeof Ionicons.glyphMap {
  if (kind === "docker" || kind === "minikube") return "cube-outline";
  if (kind === "kubernetes") return "git-network-outline";
  if (kind === "node" || kind === "vite") return "logo-nodejs";
  if (kind === "python") return "code-slash-outline";
  if (kind === "zrok") return "globe-outline";
  return "terminal-outline";
}

function shortPath(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts.at(-1) ?? value;
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : fallback;
}

const styles = StyleSheet.create({
  error: {
    color: colors.red,
    ...typeScale.label,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  filters: { gap: spacing.xs, paddingBottom: spacing.xs, paddingHorizontal: spacing.sm },
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 52,
    paddingHorizontal: spacing.xs,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  listContent: { paddingBottom: spacing.md },
  liveDot: {
    backgroundColor: colors.green,
    borderColor: colors.surface,
    borderRadius: 5,
    borderWidth: 2,
    bottom: 1,
    height: 9,
    position: "absolute",
    right: 0,
    width: 9,
  },
  profileError: { color: colors.red, ...typeScale.caption },
  root: { alignSelf: "center", flex: 1, maxWidth: 560, minHeight: 0, width: "100%" },
  rowSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
  },
  rowAction: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  rowMain: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing.sm, minWidth: 0 },
  rowTitleLine: { alignItems: "center", flexDirection: "row", gap: spacing.xxs },
  rowText: { flex: 1, minWidth: 0 },
  rowShimmer: { alignSelf: "flex-start" },
  rowTitle: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.medium },
  searchField: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  searchInput: { flex: 1, minHeight: 38, minWidth: 0 },
  sectionLabel: {
    color: colors.textDim,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    letterSpacing: typeTracking.caps,

    marginBottom: spacing.xxs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  segment: {
    alignItems: "center",
    borderRadius: radii.medium,
    flex: 1,
    justifyContent: "center",
    minHeight: 30,
  },
  segmentSelected: { backgroundColor: colors.surfaceHover },
  segmentText: { color: colors.textMuted, ...typeScale.caption, fontWeight: typeWeight.medium },
  segmentTextSelected: { color: colors.text },
  segments: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.selected,
    flexDirection: "row",
    minHeight: 34,
    padding: spacing.optical,
  },
  serviceIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 19,
    height: 38,
    justifyContent: "center",
    position: "relative",
    width: 38,
  },
  serviceRow: {
    alignItems: "center",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 62,
    paddingHorizontal: spacing.sm,
    width: "100%",
  },
  subtitle: { color: colors.textMuted, ...typeScale.caption },
  status: { color: colors.textDim, ...typeScale.caption, textTransform: "capitalize" },
  statusLive: { color: colors.green },
  title: { color: colors.text, ...typeScale.title, fontWeight: typeWeight.semibold },
  titleBlock: { flex: 1, minWidth: 0 },
});
