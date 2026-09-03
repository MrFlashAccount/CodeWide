import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { PortProfile, PortsResource } from "../../application/resources/portsResource";
import type { SavedServerId } from "../../domain/ids";
import {
  PresentationTextInput as TextInput,
  ProductText as Text,
} from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { VoiceTextInput } from "../conversation/VoiceTextInput";

interface PortProfileScreenProps {
  profileId: string;
  savedServerId: SavedServerId;
}

interface PortFormProps {
  initial: PortFormModel;
  resource: PortsResource;
  savedServerId: SavedServerId;
  serverName: string;
}

interface PortFormModel {
  forwardingKey: string | null;
  label: string;
  port: number | null;
  profile: PortProfile | null;
}

interface PortFieldProps {
  hint: string;
  label: string;
  onChange(value: string): void;
  placeholder?: string;
  value: string;
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
  const profile = snapshot.value.profiles.find((candidate) => candidate.id === profileId) ?? null;
  const port = snapshot.value.ports.find((candidate) => candidate.forwardingKey === profileId);
  const initial = formModel(profile, port, profileId === "manual");
  const serverName =
    servers.value.find((server) => server.id === savedServerId)?.displayName ?? "Server";
  if (initial === null) {
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
    <PortForm
      key={profile?.id ?? port?.forwardingKey ?? "manual"}
      initial={initial}
      resource={resource}
      savedServerId={savedServerId}
      serverName={serverName}
    />
  );
}

function PortForm(props: PortFormProps): React.JSX.Element {
  const { initial, resource, savedServerId, serverName } = props;
  const [label, setLabel] = useState(initial.label);
  const [remotePort, setRemotePort] = useState(initial.port === null ? "" : String(initial.port));
  const [localPort, setLocalPort] = useState(
    initial.profile?.preferredLocalPort === null || initial.profile === null
      ? ""
      : String(initial.profile.preferredLocalPort),
  );
  const [startImmediately, setStartImmediately] = useState(initial.profile?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startAction] = useTransition();
  const back = useEvent(() => router.back());
  const submit = useEvent(() => {
    const parsedPort = parsePort(remotePort);
    if (parsedPort === null) {
      setError("Remote port must be between 1 and 65535.");
      return;
    }
    const parsedLocalPort = localPort.trim() === "" ? null : parsePort(localPort);
    if (localPort.trim() !== "" && parsedLocalPort === null) {
      setError("Phone port must be between 1 and 65535.");
      return;
    }
    const normalizedLabel = label.trim();
    const input = {
      forwardingKey: initial.forwardingKey,
      label: normalizedLabel === "" ? `Port ${parsedPort}` : normalizedLabel,
      port: parsedPort,
      preferredLocalPort: parsedLocalPort,
      profileId: initial.profile === null ? null : initial.profile.id,
      start: startImmediately,
    };
    setError(null);
    startAction(async () => {
      try {
        await resource.create(input);
        router.back();
      } catch {
        setError("Could not start secure forwarding.");
      }
    });
  });
  const remove = useEvent(() => {
    if (initial.profile === null) return;
    const profileId = initial.profile.id;
    startAction(async () => {
      try {
        await resource.remove(profileId);
        router.back();
      } catch {
        setError("Could not remove secure forwarding.");
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
          <Text style={styles.title}>{initial.profile === null ? "Manual port" : "Edit port"}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {serverName}
          </Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>Name</Text>
        <VoiceTextInput
          accessibilityLabel="Forwarding name"
          audience={savedServerId}
          onChangeText={setLabel}
          placeholder="Frontend"
          placeholderTextColor={colors.textDim}
          scope={{ id: `port-name:${initial.profile?.id ?? "new"}`, kind: "generic" }}
          style={styles.textInput}
          thread={null}
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
            hint="automatic through secure transport"
            label="Phone port"
            onChange={setLocalPort}
            placeholder="Auto"
            value={localPort}
          />
          <View style={styles.divider} />
          <View style={styles.switchRow}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Start now</Text>
              <Text style={styles.rowSubtitle}>Open after secure forwarding starts</Text>
            </View>
            <Switch onValueChange={setStartImmediately} value={startImmediately} />
          </View>
        </View>
        {error === null ? null : <Text style={styles.error}>{error}</Text>}
        <View style={styles.actions}>
          {initial.profile === null ? null : (
            <Pressable
              accessibilityLabel="Remove forwarding"
              disabled={pending}
              onPress={remove}
              style={styles.removeButton}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityLabel="Save forwarding"
            disabled={pending}
            onPress={submit}
            style={styles.primaryButton}
          >
            {pending ? (
              <ShimmerText style={styles.primaryText} text="Saving" />
            ) : (
              <Text style={styles.primaryText}>Save</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
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

function formModel(
  profile: PortProfile | null,
  port:
    | { forwardingKey: string; group: string; kind: string; name: string; port: number }
    | undefined,
  manual: boolean,
): PortFormModel | null {
  if (profile !== null) {
    return {
      forwardingKey: profile.forwardingKey,
      label: profile.label,
      port: profile.port,
      profile,
    };
  }
  if (port !== undefined) {
    return {
      forwardingKey: port.forwardingKey,
      label: port.name === "" ? `Port ${port.port}` : port.name,
      port: port.port,
      profile: null,
    };
  }
  return manual
    ? {
        forwardingKey: null,
        label: "",
        port: null,
        profile: null,
      }
    : null;
}

function parsePort(raw: string): number | null {
  const port = Number(raw);
  return /^\d{1,5}$/u.test(raw.trim()) && Number.isSafeInteger(port) && port >= 1 && port <= 65_535
    ? port
    : null;
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
    width: "100%",
  },
  rowSubtitle: { color: colors.textMuted, ...typeScale.label },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, ...typeScale.body },
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
  title: { color: colors.text, ...typeScale.title },
  titleBlock: { flex: 1, minWidth: 0 },
});
