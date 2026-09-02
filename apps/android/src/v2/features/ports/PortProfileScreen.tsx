import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import type { V2PortDescriptor, V2TunnelCreateResponse } from "@codewide/sync-client/v2";

import { useV2Runtime } from "../../V2Application";
import type { PortsResource } from "../../application/resources/portsResource";
import type { SavedServerId } from "../../domain/ids";
import {
  PresentationTextInput as TextInput,
  ProductText as Text,
} from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";

interface PortProfileScreenProps {
  profileId: string;
  savedServerId: SavedServerId;
}

interface PortFormProps {
  port: V2PortDescriptor;
  resource: PortsResource;
  serverName: string;
}

export function PortProfileScreen(props: PortProfileScreenProps): React.JSX.Element {
  const { profileId, savedServerId } = props;
  const runtime = useV2Runtime();
  const [resource] = useState(() => runtime.ports(savedServerId));
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const port = snapshot.value.ports.find((candidate) => candidate.forwardingKey === profileId);
  const serverName =
    servers.value.find((server) => server.id === savedServerId)?.displayName ?? "Server";
  if (port === undefined) {
    return (
      <View style={styles.center}>
        {snapshot.status === "loading" ? (
          <ShimmerText style={styles.muted} text="Scanning port…" />
        ) : (
          <Text style={styles.muted}>This port is no longer available.</Text>
        )}
      </View>
    );
  }
  return (
    <PortForm key={port.forwardingKey} port={port} resource={resource} serverName={serverName} />
  );
}

function PortForm(props: PortFormProps): React.JSX.Element {
  const { port, resource, serverName } = props;
  const [label, setLabel] = useState(port.name === "" ? `Port ${port.port}` : port.name);
  const [remotePort, setRemotePort] = useState(String(port.port));
  const [localPort, setLocalPort] = useState("");
  const [startImmediately, setStartImmediately] = useState(true);
  const [tunnel, setTunnel] = useState<V2TunnelCreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startAction] = useTransition();
  const back = useEvent(() => router.back());
  const submit = useEvent(() => {
    const parsedPort = Number(remotePort);
    if (!Number.isSafeInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
      setError("Remote port must be between 1 and 65535.");
      return;
    }
    setError(null);
    if (!startImmediately) {
      router.back();
      return;
    }
    startAction(async () => {
      try {
        setTunnel(await resource.createTunnel(parsedPort));
      } catch {
        setError("Could not start secure forwarding.");
      }
    });
  });
  const remove = useEvent(() => {
    if (tunnel === null) {
      router.back();
      return;
    }
    startAction(async () => {
      try {
        await resource.deleteTunnel(tunnel.id);
        router.back();
      } catch {
        setError("Could not stop secure forwarding.");
      }
    });
  });
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Back to open ports" onPress={back} style={styles.iconButton}>
          <Ionicons color={colors.text} name="arrow-back" size={20} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{tunnel === null ? "Manual port" : label}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {serverName}
          </Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {tunnel === null ? (
          <>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              accessibilityLabel="Forwarding name"
              onChangeText={setLabel}
              placeholder="Frontend"
              placeholderTextColor={colors.textDim}
              style={styles.textInput}
              value={label}
            />
            <View style={styles.formGroup}>
              <PortField
                hint="server localhost"
                label="Remote port"
                onChange={setRemotePort}
                value={remotePort}
              />
              <View style={styles.divider} />
              <PortField
                hint="automatic if empty"
                label="Phone port"
                onChange={setLocalPort}
                placeholder="Auto"
                value={localPort}
              />
              <View style={styles.divider} />
              <View style={styles.switchRow}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Start now</Text>
                  <Text style={styles.rowSubtitle}>Keep available on this phone</Text>
                </View>
                <Switch onValueChange={setStartImmediately} value={startImmediately} />
              </View>
            </View>
          </>
        ) : (
          <View style={styles.liveCard}>
            <View style={styles.liveDot} />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{label}</Text>
              <Text selectable style={styles.rowSubtitle}>
                {tunnel.basePath}
              </Text>
            </View>
            <Text style={styles.liveLabel}>Live</Text>
          </View>
        )}
        {error === null ? null : <Text style={styles.error}>{error}</Text>}
        <View style={styles.actions}>
          {tunnel === null ? null : (
            <Pressable
              accessibilityLabel="Close tunnel"
              disabled={pending}
              onPress={remove}
              style={styles.removeButton}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityLabel={tunnel === null ? "Create secure tunnel" : "Tunnel active"}
            disabled={pending || tunnel !== null}
            onPress={submit}
            style={styles.primaryButton}
          >
            {pending ? (
              <ShimmerText style={styles.primaryText} text="Adding" />
            ) : (
              <Text style={styles.primaryText}>{tunnel === null ? "Add" : "Active"}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

interface PortFieldProps {
  hint: string;
  label: string;
  onChange(value: string): void;
  placeholder?: string;
  value: string;
}

function PortField(props: PortFieldProps): React.JSX.Element {
  const { hint, label, onChange, placeholder, value } = props;
  return (
    <View style={styles.portField}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={styles.rowSubtitle}>{hint}</Text>
      </View>
      <TextInput
        accessibilityLabel={label}
        keyboardType="number-pad"
        maxLength={5}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        style={styles.portInput}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-end",
    marginTop: spacing.sm,
    minHeight: touchTarget,
  },
  center: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
  },
  content: { gap: spacing.xs, padding: spacing.sm },
  divider: {
    backgroundColor: colors.borderSoft,
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.sm,
  },
  error: { color: colors.red, ...typeScale.label },
  fieldLabel: { color: colors.textMuted, ...typeScale.label },
  formGroup: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.selected,
    marginTop: spacing.xs,
    overflow: "hidden",
  },
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
  liveCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.sm,
  },
  liveDot: { backgroundColor: colors.green, borderRadius: 5, height: 10, width: 10 },
  liveLabel: { color: colors.green, ...typeScale.label },
  muted: { color: colors.textMuted },
  portField: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.sm,
  },
  portInput: { minHeight: touchTarget, textAlign: "right", width: 82 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: touchTarget,
    minWidth: 96,
    paddingHorizontal: spacing.sm,
  },
  primaryText: { color: colors.onPrimary, ...typeScale.body },
  removeButton: { justifyContent: "center", minHeight: touchTarget, paddingHorizontal: spacing.sm },
  removeText: { color: colors.red, ...typeScale.body },
  root: {
    alignSelf: "center",
    backgroundColor: colors.background,
    flex: 1,
    maxWidth: 560,
    minHeight: 0,
    width: "100%",
  },
  rowSubtitle: { color: colors.textMuted, ...typeScale.label },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.medium },
  subtitle: { color: colors.textMuted, ...typeScale.caption },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.sm,
  },
  textInput: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.selected,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  title: { color: colors.text, ...typeScale.title, fontWeight: typeWeight.semibold },
  titleBlock: { flex: 1, minWidth: 0 },
});
