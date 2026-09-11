import { Ionicons } from "@expo/vector-icons";
import { LegendList, type LegendListProps } from "@legendapp/list/react-native";
import { useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";

import {
  colors,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
  iconSize,
  controlSize,
  typeTracking,
  layoutSize,
} from "../theme";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import { AppListRow } from "./AppListRow";
import { listRowHeight, type AppListRowProps } from "./AppListRow.types";
import { AppText as Text, AppTextInput as TextInput } from "./Typography";

export type PortForwardingStatus = "stopped" | "connecting" | "live" | "unavailable" | "error";
export type PortForwardingDiscoveryStatus = "idle" | "loading" | "ready" | "error";
export type PortForwardingPreference = "automatic" | "included" | "excluded";

export type PortForwardingProfile = {
  id: string;
  label: string;
  remoteHost: string;
  remotePort: number;
  preferredLocalPort: number | null;
  serviceKey: string | null;
  preference: PortForwardingPreference;
  localPort: number | null;
  enabled: boolean;
  status: PortForwardingStatus;
  previewUrl: string | null;
  error: string | null;
};

export type PortForwardingCandidate = {
  port: number;
  name: string;
  group: string;
  details: string;
  process: string | null;
  pid: number | null;
  cwd: string | null;
  kind:
    | "docker"
    | "hermes"
    | "kubernetes"
    | "minikube"
    | "vite"
    | "node"
    | "python"
    | "zrok"
    | "process"
    | "system";
  forwardingKey: string;
  defaultForwardingEnabled: boolean;
};

export type PortForwardingDraft = {
  label: string;
  remoteHost: "127.0.0.1";
  remotePort: number;
  preferredLocalPort: number | null;
  startImmediately: boolean;
};

export type PortForwardingManagerProps = {
  serverName: string;
  profiles: readonly PortForwardingProfile[];
  discoveredPorts: readonly PortForwardingCandidate[];
  discoveryStatus: PortForwardingDiscoveryStatus;
  discoveryError: string | null;
  onOpen(profile: PortForwardingProfile): void;
  onSelectPort(port: PortForwardingCandidate): Promise<void>;
  onExcludePort(port: PortForwardingCandidate): Promise<void>;
  onAdd(input: PortForwardingDraft): Promise<void>;
  onEdit(id: string, input: PortForwardingDraft): Promise<void>;
  onStart(id: string): Promise<void>;
  onStop(id: string): Promise<void>;
  onReconnect(id: string): Promise<void>;
  onRemove(id: string): Promise<void>;
  onSetPreference(id: string, preference: PortForwardingPreference): Promise<void>;
  renderScrollComponent?: LegendListProps<ServiceListRow>["renderScrollComponent"];
};

type ServiceSegment = "active" | "available" | "excluded";
type ServiceEntry =
  | { type: "candidate"; group: string; candidate: PortForwardingCandidate }
  | {
      type: "profile";
      group: string;
      profile: PortForwardingProfile;
      kind: PortForwardingCandidate["kind"];
    };
type ServiceListRow = ServiceEntry | { type: "group"; group: string };

const GROUP_HEIGHT = 36;
const PROFILE_ERROR_HEIGHT = 52;

function serviceRowKey(entry: ServiceListRow): string {
  if (entry.type === "group") return `group:${entry.group}`;
  return entry.type === "candidate"
    ? `candidate:${entry.candidate.forwardingKey}`
    : `profile:${entry.profile.id}`;
}

function hasProfileError(profile: PortForwardingProfile): boolean {
  return (profile.status === "error" || profile.status === "unavailable") && profile.error !== null;
}

type FormState = {
  id: string | null;
  label: string;
  remotePort: string;
  localPort: string;
  startImmediately: boolean;
};
const EMPTY_FORM: FormState = {
  id: null,
  label: "",
  remotePort: "3000",
  localPort: "",
  startImmediately: true,
};

export function PortForwardingManager(props: PortForwardingManagerProps) {
  const [form, setForm] = useState<FormState | null>(null);
  const [segment, setSegment] = useState<ServiceSegment>("active");
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingPort, setPendingPort] = useState<number | null>(null);
  const [webMenuId, setWebMenuId] = useState<string | null>(null);

  const closeForm = () => {
    setForm(null);
    setFormError(null);
  };
  const openManual = () => {
    setForm({ ...EMPTY_FORM });
    setFormError(null);
  };
  const openEdit = (profile: PortForwardingProfile) => {
    setForm({
      id: profile.id,
      label: profile.label,
      remotePort: String(profile.remotePort),
      localPort: profile.preferredLocalPort === null ? "" : String(profile.preferredLocalPort),
      startImmediately: profile.enabled,
    });
    setFormError(null);
  };
  const submit = async () => {
    if (form === null) return;
    let draft: PortForwardingDraft;
    try {
      draft = parseForwardingDraft(form);
    } catch (cause) {
      setFormError(message(cause, "Check the port values"));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      if (form.id === null) await props.onAdd(draft);
      else await props.onEdit(form.id, draft);
      closeForm();
    } catch (cause) {
      setFormError(message(cause, "Could not save port forwarding"));
    }
    setSubmitting(false);
  };
  const removeCurrent = async () => {
    if (form?.id === null || form?.id === undefined) return;
    setSubmitting(true);
    try {
      await props.onRemove(form.id);
      closeForm();
    } catch (cause) {
      setFormError(message(cause, "Could not remove port forwarding"));
    }
    setSubmitting(false);
  };
  const runProfileAction = async (id: string, action: () => Promise<void>) => {
    setPendingId(id);
    setActionError(null);
    setWebMenuId(null);
    try {
      await action();
    } catch (cause) {
      setActionError(message(cause, "Could not update port forwarding"));
    }
    setPendingId((current) => (current === id ? null : current));
  };
  const choosePort = async (candidate: PortForwardingCandidate) => {
    setPendingPort(candidate.port);
    setActionError(null);
    try {
      await props.onSelectPort(candidate);
    } catch (cause) {
      setActionError(message(cause, "Could not forward this port"));
    }
    setPendingPort((current) => (current === candidate.port ? null : current));
  };
  const excludePort = async (candidate: PortForwardingCandidate) => {
    setPendingPort(candidate.port);
    setActionError(null);
    try {
      await props.onExcludePort(candidate);
    } catch (cause) {
      setActionError(message(cause, "Could not exclude this port"));
    }
    setPendingPort((current) => (current === candidate.port ? null : current));
  };

  if (form !== null)
    return (
      <ManualPortForm
        serverName={props.serverName}
        form={form}
        submitting={submitting}
        error={formError}
        onChange={setForm}
        onBack={closeForm}
        onSubmit={() => void submit()}
        {...(form.id === null ? {} : { onRemove: () => void removeCurrent() })}
      />
    );

  const currentProfiles = props.profiles.filter((profile) => props.discoveredPorts.some((candidate) =>
    profile.serviceKey === candidate.forwardingKey || (profile.serviceKey === null && profile.remotePort === candidate.port)));
  const configuredKeys = new Set(
    currentProfiles
      .map((profile) => profile.serviceKey)
      .filter((key): key is string => key !== null),
  );
  const configuredPorts = new Set(currentProfiles.map((profile) => profile.remotePort));
  const availableCandidates = props.discoveredPorts.filter(
    (candidate) =>
      !candidate.defaultForwardingEnabled && !configuredKeys.has(candidate.forwardingKey) && !configuredPorts.has(candidate.port),
  );
  const activeProfiles = currentProfiles.filter((profile) => profile.preference !== "excluded");
  const excludedProfiles = currentProfiles.filter((profile) => profile.preference === "excluded");
  const entries: ServiceEntry[] =
    segment === "available"
      ? availableCandidates.map((candidate) => ({
          type: "candidate",
          group: candidate.group,
          candidate,
        }))
      : (segment === "active" ? activeProfiles : excludedProfiles).flatMap((profile) => {
          const candidate = props.discoveredPorts.find(
            (value) =>
              value.forwardingKey === profile.serviceKey || (profile.serviceKey === null && value.port === profile.remotePort),
          );
          if (candidate === undefined) return [];
          return [{
            type: "profile" as const,
            group: candidate.group,
            profile,
            kind: candidate.kind,
          }];
        });
  const needle = query.trim().toLocaleLowerCase();
  const groups = groupEntries(entries.filter((entry) => serviceEntryMatches(entry, needle)));
  const rows: ServiceListRow[] = [];
  for (const [group, members] of groups) {
    rows.push({ type: "group", group });
    for (const member of members) rows.push(member);
  }
  const counts: Record<ServiceSegment, number> = {
    active: activeProfiles.length,
    available: availableCandidates.length,
    excluded: excludedProfiles.length,
  };
  return (
    <View testID="port-forwarding-manager" style={styles.root}>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Ports</Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {props.serverName}
          </Text>
        </View>
      </View>

      <View style={styles.filters}>
        <View accessibilityRole="tablist" style={styles.segments}>
          {(["active", "available", "excluded"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: segment === value }}
              onPress={() => setSegment(value)}
              style={[styles.segment, segment === value && styles.segmentSelected]}
            >
              <Text
                style={[styles.segmentText, segment === value && styles.segmentTextSelected]}
              >{`${segmentTitle(value)} ${counts[value]}`}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.searchField}>
          <Ionicons name="search" size={iconSize.inline} color={colors.textDim} />
          <TextInput
            accessibilityLabel="Filter ports"
            value={query}
            onChangeText={setQuery}
            placeholder="Name, category or port"
            placeholderTextColor={colors.textDim}
            style={styles.searchInput}
          />
          {query !== "" && (
            <Pressable accessibilityLabel="Clear port filter" onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={iconSize.inline} color={colors.textDim} />
            </Pressable>
          )}
        </View>
      </View>

      <LegendList
        style={styles.list}
        data={rows}
        drawDistance={360}
        keyExtractor={serviceRowKey}
        recycleItems
        getFixedItemSize={(entry) =>
          entry.type === "group"
            ? GROUP_HEIGHT
            : listRowHeight.double +
              (entry.type === "profile" && hasProfileError(entry.profile)
                ? PROFILE_ERROR_HEIGHT
                : 0) +
              (entry.type === "profile" && Platform.OS === "web" && webMenuId === entry.profile.id
                ? controlSize.regular
                : 0)
        }
        nestedScrollEnabled
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        {...(props.renderScrollComponent === undefined
          ? {}
          : { renderScrollComponent: props.renderScrollComponent })}
        ListHeaderComponent={
          <>
            {actionError !== null && <InlineError value={actionError} />}
            {props.discoveryStatus === "loading" && props.discoveredPorts.length === 0 && (
              <InfoRow
                icon="scan-outline"
                title="Looking for open ports…"
                subtitle="Reading localhost listeners"
                loading
              />
            )}
            {props.discoveryStatus === "error" && (
              <InfoRow
                icon="alert-circle-outline"
                title="Could not scan ports"
                subtitle={props.discoveryError ?? "Waiting for automatic discovery"}
              />
            )}
            {props.discoveryStatus === "ready" && groups.length === 0 && (
              <InfoRow
                icon={segment === "excluded" ? "ban-outline" : "checkmark-circle-outline"}
                title={emptySegmentTitle(segment)}
                subtitle={
                  query === ""
                    ? emptySegmentSubtitle(segment)
                    : "Try another name, category or port"
                }
              />
            )}
          </>
        }
        renderItem={({ item: entry, index }) =>
          entry.type === "group" ? (
            <View style={styles.groupCell}>
              <SectionLabel value={entry.group} />
            </View>
          ) : entry.type === "candidate" ? (
            <CandidateRow
              key={entry.candidate.forwardingKey}
              candidate={entry.candidate}
              position={serviceRowPosition(rows, index)}
              pending={pendingPort === entry.candidate.port}
              onPress={() => void choosePort(entry.candidate)}
              onExclude={() => void excludePort(entry.candidate)}
            />
          ) : (
            <ForwardingRow
              key={entry.profile.id}
              position={serviceRowPosition(rows, index)}
              profile={entry.profile}
              kind={entry.kind}
              pending={pendingId === entry.profile.id}
              webMenuVisible={webMenuId === entry.profile.id}
              onToggleWebMenu={() =>
                setWebMenuId((current) => (current === entry.profile.id ? null : entry.profile.id))
              }
              onEdit={() => openEdit(entry.profile)}
              onOpen={() => props.onOpen(entry.profile)}
              onStart={() =>
                void runProfileAction(entry.profile.id, () => props.onStart(entry.profile.id))
              }
              onStop={() =>
                void runProfileAction(entry.profile.id, () => props.onStop(entry.profile.id))
              }
              onReconnect={() =>
                void runProfileAction(entry.profile.id, () => props.onReconnect(entry.profile.id))
              }
              onRemove={() =>
                void runProfileAction(entry.profile.id, () => props.onRemove(entry.profile.id))
              }
              onInclude={() =>
                void runProfileAction(entry.profile.id, () =>
                  props.onSetPreference(entry.profile.id, "included"),
                )
              }
            />
          )
        }
        ListFooterComponent={
          segment === "available" && query === "" ? (
            <AppListRow
              title="Port not listed"
              description="Enter a localhost port manually"
              onPress={openManual}
              leading={<ServiceIcon name="keypad-outline" />}
            />
          ) : null
        }
      />
    </View>
  );
}

function CandidateRow({
  candidate,
  position,
  pending,
  onPress,
  onExclude,
}: {
  candidate: PortForwardingCandidate;
  position: NonNullable<AppListRowProps["position"]>;
  pending: boolean;
  onPress(): void;
  onExclude(): void;
}) {
  const detail = candidate.cwd === null ? candidate.process : shortCwd(candidate.cwd);
  return (
    <AppListRow
      testID={`discovered-port-${candidate.port}`}
      title={candidate.name}
      description={`:${candidate.port}${detail === null ? "" : ` · ${detail}`}`}
      accessibilityLabel={`Forward ${candidate.name} port ${candidate.port}`}
      disabled={pending}
      onPress={onPress}
      fixedHeight={listRowHeight.double}
      position={position}
      leading={<ServiceIcon name={candidateIcon(candidate.kind)} />}
      trailing={
        pending ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : (
          <>
            <Ionicons name="add" size={iconSize.action} color={colors.textMuted} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Exclude ${candidate.name} port ${candidate.port}`}
              onPress={onExclude}
              style={styles.iconButton}
            >
              <Ionicons name="ban-outline" size={iconSize.action} color={colors.textDim} />
            </Pressable>
          </>
        )
      }
    />
  );
}

function ForwardingRow(props: {
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

function ManualPortForm(props: {
  serverName: string;
  form: FormState;
  submitting: boolean;
  error: string | null;
  onChange(next: FormState): void;
  onBack(): void;
  onSubmit(): void;
  onRemove?: () => void;
}) {
  const update = (patch: Partial<FormState>) => props.onChange({ ...props.form, ...patch });
  return (
    <View testID="port-forwarding-form" style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to open ports"
          onPress={props.onBack}
          style={styles.iconButton}
        >
          <Ionicons name="arrow-back" size={iconSize.action} color={colors.text} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{props.form.id === null ? "Manual port" : "Edit port"}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {props.serverName}
          </Text>
        </View>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.formContent}
      >
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          accessibilityLabel="Forwarding name"
          value={props.form.label}
          onChangeText={(label) => update({ label })}
          placeholder="Frontend"
          placeholderTextColor={colors.textDim}
          style={styles.textInput}
        />
        <View style={styles.formGroup}>
          <PortField
            label="Remote port"
            hint="server localhost"
            accessibilityLabel="Remote server port"
            value={props.form.remotePort}
            onChange={(remotePort) => update({ remotePort })}
          />
          <View style={styles.divider} />
          <PortField
            label="Phone port"
            hint="automatic if empty"
            accessibilityLabel="Preferred phone port"
            value={props.form.localPort}
            placeholder="Auto"
            onChange={(localPort) => update({ localPort })}
          />
          <View style={styles.divider} />
          <View style={styles.switchRow}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Start now</Text>
              <Text style={styles.rowSubtitle}>Keep available on this phone</Text>
            </View>
            <Switch
              value={props.form.startImmediately}
              onValueChange={(startImmediately) => update({ startImmediately })}
            />
          </View>
        </View>
        {props.error !== null && <InlineError value={props.error} />}
        <View style={styles.formActions}>
          {props.onRemove !== undefined && (
            <Pressable
              accessibilityLabel="Remove forwarding"
              disabled={props.submitting}
              onPress={props.onRemove}
              style={styles.removeButton}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityLabel={props.form.id === null ? "Forward port" : "Apply forwarding changes"}
            disabled={props.submitting}
            onPress={props.onSubmit}
            style={styles.primaryButton}
          >
            {props.submitting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.primaryText}>{props.form.id === null ? "Forward" : "Apply"}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function PortField(props: {
  label: string;
  hint: string;
  accessibilityLabel: string;
  value: string;
  placeholder?: string;
  onChange(value: string): void;
}) {
  return (
    <View style={styles.portField}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{props.label}</Text>
        <Text style={styles.rowSubtitle}>{props.hint}</Text>
      </View>
      <TextInput
        accessibilityLabel={props.accessibilityLabel}
        keyboardType="number-pad"
        maxLength={5}
        value={props.value}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textDim}
        onChangeText={props.onChange}
        style={styles.portInput}
      />
    </View>
  );
}
// Keep the service avatar and live badge together. Its custom slot selects AppListRow's
// whole-row React Native renderer, so independent port actions need no Compose bridge.
function ServiceIcon({
  name,
  live = false,
}: {
  name: ComponentProps<typeof Ionicons>["name"];
  live?: boolean;
}) {
  return (
    <View style={styles.serviceIcon}>
      <Ionicons name={name} size={iconSize.action} color={colors.textMuted} />
      {live && <View style={styles.liveDot} />}
    </View>
  );
}
function SectionLabel({ value }: { value: string }) {
  return <Text style={styles.sectionLabel}>{value}</Text>;
}
function InlineError({ value }: { value: string }) {
  return (
    <View accessibilityRole="alert" style={styles.inlineError}>
      <Ionicons name="alert-circle-outline" size={iconSize.inline} color={colors.red} />
      <Text style={styles.errorText}>{value}</Text>
    </View>
  );
}
function InfoRow({
  icon,
  title,
  subtitle,
  loading = false,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  loading?: boolean;
}) {
  return (
    <AppListRow
      title={title}
      description={subtitle}
      multiline
      leading={<ServiceIcon name={icon} />}
      trailing={loading ? <ActivityIndicator size="small" color={colors.textDim} /> : undefined}
    />
  );
}
function SmallAction({
  label,
  title,
  danger = false,
  onPress,
}: {
  label: string;
  title: string;
  danger?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={styles.smallAction}>
      <Text style={[styles.smallActionText, danger && { color: colors.red }]}>{title}</Text>
    </Pressable>
  );
}

export function parseForwardingDraft(
  form: Pick<FormState, "label" | "remotePort" | "localPort" | "startImmediately">,
): PortForwardingDraft {
  const remotePort = parsePort(form.remotePort, "Remote port");
  const preferredLocalPort =
    form.localPort.trim() === "" ? null : parsePort(form.localPort, "Phone port");
  return {
    label: form.label.trim() || `Port ${remotePort}`,
    remoteHost: "127.0.0.1",
    remotePort,
    preferredLocalPort,
    startImmediately: form.startImmediately,
  };
}
function parsePort(raw: string, label: string): number {
  const port = Number(raw);
  if (!/^\d{1,5}$/u.test(raw.trim()) || !Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error(`${label} must be between 1 and 65535`);
  return port;
}
function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts.at(-1) ?? cwd;
}
function candidateIcon(
  kind: PortForwardingCandidate["kind"],
): ComponentProps<typeof Ionicons>["name"] {
  if (kind === "docker" || kind === "minikube") return "cube-outline";
  if (kind === "kubernetes") return "git-network-outline";
  if (kind === "node" || kind === "vite") return "logo-nodejs";
  if (kind === "python") return "code-slash-outline";
  if (kind === "zrok") return "globe-outline";
  if (kind === "system") return "settings-outline";
  if (kind === "hermes") return "chatbubble-ellipses-outline";
  return "terminal-outline";
}
function groupEntries(entries: readonly ServiceEntry[]): Array<[string, ServiceEntry[]]> {
  const groups = new Map<string, ServiceEntry[]>();
  for (const entry of entries) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  return [...groups].sort(([left], [right]) => left.localeCompare(right));
}
function serviceEntryMatches(entry: ServiceEntry, needle: string): boolean {
  if (needle === "") return true;
  if (entry.type === "candidate") {
    const { candidate } = entry;
    return [
      candidate.name,
      candidate.group,
      candidate.details,
      candidate.kind,
      String(candidate.port),
    ].some((value) => value.toLocaleLowerCase().includes(needle));
  }
  return [entry.profile.label, entry.group, entry.kind, String(entry.profile.remotePort)].some(
    (value) => value.toLocaleLowerCase().includes(needle),
  );
}
function serviceRowPosition(
  rows: readonly ServiceListRow[],
  index: number,
): NonNullable<AppListRowProps["position"]> {
  const current = rows[index];
  if (current === undefined || current.type === "group") return "only";
  const previous = rows[index - 1];
  const next = rows[index + 1];
  const first =
    previous === undefined || previous.type === "group" || previous.group !== current.group;
  const last = next === undefined || next.type === "group" || next.group !== current.group;
  if (first && last) return "only";
  if (first) return "first";
  return last ? "last" : "middle";
}
function segmentTitle(segment: ServiceSegment): string {
  return segment === "active" ? "Active" : segment === "available" ? "Available" : "Excluded";
}
function emptySegmentTitle(segment: ServiceSegment): string {
  return segment === "active"
    ? "No active ports"
    : segment === "available"
      ? "No available ports"
      : "No excluded ports";
}
function emptySegmentSubtitle(segment: ServiceSegment): string {
  return segment === "active"
    ? "Include a discovered service or add a port manually"
    : segment === "available"
      ? "Every discovered service is active or excluded"
      : "Services you exclude will appear here";
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, width: "100%" },
  header: {
    minHeight: touchTarget,
    marginBottom: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
  },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { color: colors.text, ...typeScale.heading, fontWeight: typeWeight.semibold },
  subtitle: { color: colors.textMuted, ...typeScale.label },
  iconButton: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
  },
  filters: { gap: spacing.xs, paddingBottom: spacing.xs },
  segments: {
    minHeight: controlSize.compact,
    flexDirection: "row",
    padding: spacing.optical,
    borderRadius: radii.selected,
    backgroundColor: colors.surfaceContainerLow,
  },
  segment: {
    flex: 1,
    minHeight: controlSize.compact,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
  },
  segmentSelected: { backgroundColor: colors.surfaceHover },
  segmentText: { color: colors.textMuted, ...typeScale.label, fontWeight: typeWeight.medium },
  segmentTextSelected: { color: colors.text },
  searchField: {
    minHeight: controlSize.touch,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.selected,
    backgroundColor: colors.surfaceContainerLow,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: controlSize.touch,
    paddingVertical: 0,
    color: colors.text,
    ...typeScale.body,
  },
  listContent: { paddingBottom: spacing.md },
  list: { flex: 1, minHeight: 0 },
  groupCell: { height: GROUP_HEIGHT },
  profileErrorCell: { height: PROFILE_ERROR_HEIGHT },
  sectionLabel: {
    marginTop: spacing.sm,
    marginBottom: spacing.xxs,
    color: colors.textDim,
    ...typeScale.caption,
    letterSpacing: typeTracking.caps,
    fontWeight: typeWeight.semibold,
  },
  serviceIcon: {
    width: controlSize.regular,
    height: controlSize.regular,
    flexShrink: 0,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceContainerLow,
    position: "relative",
  },
  liveDot: {
    position: "absolute",
    right: 0,
    bottom: 1,
    width: 9,
    height: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.green,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  rowText: { flex: 1, minWidth: 0, gap: spacing.optical },
  rowTitle: { flexShrink: 1, color: colors.text, ...typeScale.body, fontWeight: typeWeight.medium },
  rowSubtitle: { color: colors.textMuted, ...typeScale.label, fontVariant: ["tabular-nums"] },
  menuAnchor: { width: touchTarget, height: touchTarget },
  profileError: {
    marginLeft: controlSize.regular + spacing.sm,
    marginRight: spacing.md,
    marginBottom: spacing.xxs,
    color: colors.red,
    ...typeScale.label,
  },
  profileUnavailable: { color: colors.amber },
  webActions: {
    height: controlSize.regular,
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: spacing.sm,
  },
  smallAction: {
    minHeight: controlSize.regular,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  smallActionText: { color: colors.textMuted, ...typeScale.label },
  formContent: { padding: spacing.sm, gap: spacing.xs },
  fieldLabel: { color: colors.textMuted, ...typeScale.label },
  textInput: {
    minHeight: touchTarget,
    borderRadius: radii.selected,
    backgroundColor: colors.surfaceContainerLow,
    color: colors.text,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  formGroup: {
    marginTop: spacing.xs,
    overflow: "hidden",
    borderRadius: radii.selected,
    backgroundColor: colors.surfaceContainerLow,
  },
  portField: {
    minHeight: layoutSize.row,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  portInput: {
    width: 82,
    minHeight: touchTarget,
    color: colors.text,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
    paddingVertical: spacing.xs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.sm,
    backgroundColor: colors.borderSoft,
  },
  switchRow: {
    minHeight: layoutSize.row,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  inlineError: {
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  errorText: { flex: 1, color: colors.red, ...typeScale.label },
  formActions: {
    minHeight: touchTarget,
    marginTop: spacing.sm,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.xs,
  },
  primaryButton: {
    minWidth: controlSize.touch,
    minHeight: touchTarget,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
    backgroundColor: colors.primary,
  },
  primaryText: { color: colors.onPrimary, ...typeScale.body },
  removeButton: {
    minHeight: touchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  removeText: { color: colors.red, ...typeScale.body },
  rowPressed: { backgroundColor: colors.surfaceHover },
  pressed: { opacity: 0.64 },
});
