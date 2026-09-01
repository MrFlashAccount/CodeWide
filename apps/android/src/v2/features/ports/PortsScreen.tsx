import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { V2PortDescriptor } from "@codewide/sync-client/v2";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import {
  ProductText as Text,
  PresentationTextInput as TextInput,
} from "../../presentation/text/ProductText";
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
import { portDestination } from "../navigation/routeDestinations";

interface PortsScreenProps {
  savedServerId: SavedServerId;
}

interface PortRowProps {
  port: V2PortDescriptor;
  savedServerId: SavedServerId;
}

type ServiceSegment = "active" | "available" | "excluded";

interface SegmentButtonProps {
  count: number;
  label: string;
  onPress(): void;
  selected: boolean;
}

interface EmptySegmentProps {
  segment: Exclude<ServiceSegment, "available">;
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
  const [segment, setSegment] = useState<ServiceSegment>("available");
  const [query, setQuery] = useState("");
  const serverName =
    servers.value.find((server) => server.id === savedServerId)?.displayName ?? "Server";
  const needle = query.trim().toLocaleLowerCase();
  const filtered = snapshot.value.ports.filter((port) => matches(port, needle));
  const refresh = useEvent(() => {
    void resource.refresh().catch(() => undefined);
  });
  const clear = useEvent(() => setQuery(""));
  const showActive = useEvent(() => setSegment("active"));
  const showAvailable = useEvent(() => setSegment("available"));
  const showExcluded = useEvent(() => setSegment("excluded"));

  return (
    <View testID="v2-port-forwarding-manager" style={styles.root}>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Ports</Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {serverName}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Refresh open ports"
          accessibilityRole="button"
          disabled={snapshot.status === "loading"}
          onPress={refresh}
          style={styles.iconButton}
        >
          {snapshot.status === "loading" ? (
            <ActivityIndicator color={colors.textMuted} size="small" />
          ) : (
            <Ionicons color={colors.textMuted} name="refresh" size={19} />
          )}
        </Pressable>
      </View>
      <View style={styles.filters}>
        <View accessibilityRole="tablist" style={styles.segments}>
          <SegmentButton
            count={0}
            label="Active"
            onPress={showActive}
            selected={segment === "active"}
          />
          <SegmentButton
            count={snapshot.value.ports.length}
            label="Available"
            onPress={showAvailable}
            selected={segment === "available"}
          />
          <SegmentButton
            count={0}
            label="Excluded"
            onPress={showExcluded}
            selected={segment === "excluded"}
          />
        </View>
        <View style={styles.searchField}>
          <Ionicons color={colors.textDim} name="search" size={16} />
          <TextInput
            accessibilityLabel="Filter ports"
            onChangeText={setQuery}
            placeholder="Name, category or port"
            placeholderTextColor={colors.textDim}
            style={styles.searchInput}
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
        {segment !== "available" ? (
          <EmptySegment segment={segment} />
        ) : snapshot.status === "loading" && snapshot.value.ports.length === 0 ? (
          <InfoRow loading subtitle="Reading localhost listeners" title="Looking for open ports…" />
        ) : snapshot.status === "error" && snapshot.value.ports.length === 0 ? (
          <InfoRow subtitle="Tap refresh to try again" title="Could not scan ports" />
        ) : filtered.length === 0 ? (
          <InfoRow
            subtitle={
              query === ""
                ? "No localhost listeners were discovered"
                : "Try another name, category or port"
            }
            title="No available ports"
          />
        ) : (
          groupPorts(filtered).map((group) => (
            <View key={group.name}>
              <Text style={styles.sectionLabel}>{group.name}</Text>
              {group.ports.map((port) => (
                <PortRow key={port.forwardingKey} port={port} savedServerId={savedServerId} />
              ))}
            </View>
          ))
        )}
        {segment === "available" && query === "" ? <ManualPortRow /> : null}
      </ScrollView>
    </View>
  );
}

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
  const { port, savedServerId } = props;
  const open = useEvent(() => router.push(portDestination(savedServerId, port.forwardingKey)));
  const detail = port.cwd ?? port.process;
  return (
    <Pressable
      accessibilityLabel={`Forward ${port.name} port ${port.port}`}
      accessibilityRole="button"
      onPress={open}
      style={styles.serviceRow}
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
      <Ionicons color={colors.textMuted} name="add" size={20} />
    </Pressable>
  );
}

function ManualPortRow(): React.JSX.Element {
  return (
    <View style={styles.serviceRow}>
      <View style={styles.serviceIcon}>
        <Ionicons color={colors.textMuted} name="keypad-outline" size={19} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>Port not listed</Text>
        <Text style={styles.rowSubtitle}>Enter a localhost port manually</Text>
      </View>
      <Ionicons color={colors.textDim} name="chevron-forward" size={17} />
    </View>
  );
}

function EmptySegment(props: EmptySegmentProps): React.JSX.Element {
  const { segment } = props;
  return (
    <InfoRow
      subtitle={
        segment === "active"
          ? "Include a discovered service or add a port manually"
          : "Services you exclude will appear here"
      }
      title={segment === "active" ? "No active ports" : "No excluded ports"}
    />
  );
}

function InfoRow(props: InfoRowProps): React.JSX.Element {
  const { loading = false, subtitle, title } = props;
  return (
    <View style={styles.serviceRow}>
      <View style={styles.serviceIcon}>
        <Ionicons
          color={colors.textMuted}
          name={loading ? "scan-outline" : "information-circle-outline"}
          size={19}
        />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text numberOfLines={2} style={styles.rowSubtitle}>
          {subtitle}
        </Text>
      </View>
      {loading ? <ActivityIndicator color={colors.textDim} size="small" /> : null}
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

const styles = StyleSheet.create({
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
  root: { alignSelf: "center", flex: 1, maxWidth: 560, minHeight: 0, width: "100%" },
  rowSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
  },
  rowText: { flex: 1, minWidth: 0 },
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
  title: { color: colors.text, ...typeScale.title, fontWeight: typeWeight.semibold },
  titleBlock: { flex: 1, minWidth: 0 },
});
