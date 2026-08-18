import { Ionicons } from "@expo/vector-icons";
import { useState, type ComponentProps } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";

import { colors, radii, spacing, touchTarget, typeScale } from "../theme";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import { AppText as Text, AppTextInput as TextInput } from "./Typography";

export type PortForwardingStatus = "stopped" | "connecting" | "live" | "error";
export type PortForwardingDiscoveryStatus = "idle" | "loading" | "ready" | "error";

export type PortForwardingProfile = {
  id: string;
  label: string;
  remoteHost: string;
  remotePort: number;
  preferredLocalPort: number | null;
  localPort: number | null;
  status: PortForwardingStatus;
  previewUrl: string | null;
  error: string | null;
};

export type PortForwardingCandidate = {
  port: number;
  name: string;
  process: string | null;
  pid: number | null;
  cwd: string | null;
  kind: "web" | "node" | "python" | "container" | "service";
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
  onRefresh(): Promise<void>;
  onSelectPort(port: PortForwardingCandidate): Promise<void>;
  onAdd(input: PortForwardingDraft): Promise<void>;
  onEdit(id: string, input: PortForwardingDraft): Promise<void>;
  onStart(id: string): Promise<void>;
  onStop(id: string): Promise<void>;
  onReconnect(id: string): Promise<void>;
  onRemove(id: string): Promise<void>;
  onOpen(id: string): void;
};

type FormState = { id: string | null; label: string; remotePort: string; localPort: string; startImmediately: boolean };
const EMPTY_FORM: FormState = { id: null, label: "", remotePort: "3000", localPort: "", startImmediately: true };

export function PortForwardingManager(props: PortForwardingManagerProps) {
  const [form, setForm] = useState<FormState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingPort, setPendingPort] = useState<number | null>(null);
  const [webMenuId, setWebMenuId] = useState<string | null>(null);

  const closeForm = () => { setForm(null); setFormError(null); };
  const openManual = () => { setForm({ ...EMPTY_FORM }); setFormError(null); };
  const openEdit = (profile: PortForwardingProfile) => {
    setForm({
      id: profile.id,
      label: profile.label,
      remotePort: String(profile.remotePort),
      localPort: profile.preferredLocalPort === null ? "" : String(profile.preferredLocalPort),
      startImmediately: profile.status === "live" || profile.status === "connecting",
    });
    setFormError(null);
  };
  const submit = async () => {
    if (form === null) return;
    let draft: PortForwardingDraft;
    try { draft = parseForwardingDraft(form); }
    catch (cause) { setFormError(message(cause, "Check the port values")); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      if (form.id === null) await props.onAdd(draft);
      else await props.onEdit(form.id, draft);
      closeForm();
    } catch (cause) { setFormError(message(cause, "Could not save port forwarding")); }
    setSubmitting(false);
  };
  const removeCurrent = async () => {
    if (form?.id === null || form?.id === undefined) return;
    setSubmitting(true);
    try { await props.onRemove(form.id); closeForm(); }
    catch (cause) { setFormError(message(cause, "Could not remove port forwarding")); }
    setSubmitting(false);
  };
  const runProfileAction = async (id: string, action: () => Promise<void>) => {
    setPendingId(id); setActionError(null); setWebMenuId(null);
    try { await action(); }
    catch (cause) { setActionError(message(cause, "Could not update port forwarding")); }
    setPendingId((current) => current === id ? null : current);
  };
  const choosePort = async (candidate: PortForwardingCandidate) => {
    setPendingPort(candidate.port); setActionError(null);
    try { await props.onSelectPort(candidate); }
    catch (cause) { setActionError(message(cause, "Could not forward this port")); }
    setPendingPort((current) => current === candidate.port ? null : current);
  };

  if (form !== null) return (
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

  const configuredPorts = new Set(props.profiles.map((profile) => profile.remotePort));
  const candidates = props.discoveredPorts.filter((candidate) => !configuredPorts.has(candidate.port));
  return (
    <View testID="port-forwarding-manager" style={styles.root}>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Ports</Text>
          <Text numberOfLines={1} style={styles.subtitle}>{props.serverName}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh open ports"
          disabled={props.discoveryStatus === "loading"}
          onPress={() => void props.onRefresh()}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          {props.discoveryStatus === "loading"
            ? <ActivityIndicator size="small" color={colors.textMuted} />
            : <Ionicons name="refresh" size={19} color={colors.textMuted} />}
        </Pressable>
      </View>

      <ScrollView nestedScrollEnabled contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {actionError !== null && <InlineError value={actionError} />}
        {props.profiles.length > 0 && <SectionLabel value="FORWARDED" />}
        {props.profiles.map((profile) => (
          <ForwardingRow
            key={profile.id}
            profile={profile}
            pending={pendingId === profile.id}
            webMenuVisible={webMenuId === profile.id}
            onToggleWebMenu={() => setWebMenuId((current) => current === profile.id ? null : profile.id)}
            onEdit={() => openEdit(profile)}
            onOpen={() => props.onOpen(profile.id)}
            onStart={() => void runProfileAction(profile.id, () => props.onStart(profile.id))}
            onStop={() => void runProfileAction(profile.id, () => props.onStop(profile.id))}
            onReconnect={() => void runProfileAction(profile.id, () => props.onReconnect(profile.id))}
            onRemove={() => void runProfileAction(profile.id, () => props.onRemove(profile.id))}
          />
        ))}

        <SectionLabel value="OPEN ON SERVER" />
        {props.discoveryStatus === "loading" && props.discoveredPorts.length === 0 && (
          <InfoRow icon="scan-outline" title="Looking for open ports…" subtitle="Reading localhost listeners" loading />
        )}
        {props.discoveryStatus === "error" && props.discoveredPorts.length === 0 && (
          <InfoRow icon="alert-circle-outline" title="Could not scan ports" subtitle={props.discoveryError ?? "Tap refresh to try again"} />
        )}
        {props.discoveryStatus === "ready" && candidates.length === 0 && (
          <InfoRow icon="checkmark-circle-outline" title="No other open ports" subtitle="Everything discovered is already forwarded" />
        )}
        {candidates.map((candidate) => (
          <CandidateRow key={candidate.port} candidate={candidate} pending={pendingPort === candidate.port} onPress={() => void choosePort(candidate)} />
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel="Port not listed" onPress={openManual} style={({ pressed }) => [styles.serviceRow, pressed && styles.rowPressed]}>
          <ServiceIcon name="keypad-outline" />
          <View style={styles.rowText}>
            <Text numberOfLines={1} style={styles.rowTitle}>Port not listed</Text>
            <Text numberOfLines={1} style={styles.rowSubtitle}>Enter a localhost port manually</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={colors.textDim} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

function CandidateRow({ candidate, pending, onPress }: { candidate: PortForwardingCandidate; pending: boolean; onPress(): void }) {
  const detail = candidate.cwd === null ? candidate.process : shortCwd(candidate.cwd);
  return (
    <Pressable
      testID={`discovered-port-${candidate.port}`}
      accessibilityRole="button"
      accessibilityLabel={`Forward ${candidate.name} port ${candidate.port}`}
      disabled={pending}
      onPress={onPress}
      style={({ pressed }) => [styles.serviceRow, pressed && styles.rowPressed]}
    >
      <ServiceIcon name={candidateIcon(candidate.kind)} />
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowTitle}>{candidate.name}</Text>
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.rowSubtitle}>{`:${candidate.port}${detail === null ? "" : ` · ${detail}`}`}</Text>
      </View>
      {pending ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Ionicons name="add" size={20} color={colors.textMuted} />}
    </Pressable>
  );
}

function ForwardingRow(props: {
  profile: PortForwardingProfile; pending: boolean; webMenuVisible: boolean; onToggleWebMenu(): void;
  onEdit(): void; onOpen(): void; onStart(): void; onStop(): void; onReconnect(): void; onRemove(): void;
}) {
  const { profile } = props;
  const live = profile.status === "live";
  const connecting = profile.status === "connecting";
  const errored = profile.status === "error";
  const status = props.pending ? "Updating" : live ? "Live" : errored ? "Error" : connecting ? "Connecting" : "Stopped";
  const color = live ? colors.green : errored ? colors.red : connecting ? colors.amber : colors.textDim;
  const primary = live || connecting ? props.onStop : errored ? props.onReconnect : props.onStart;
  const primaryId = live || connecting ? "stop" : errored ? "reconnect" : "start";
  const primaryTitle = live || connecting ? "Stop" : errored ? "Reconnect" : "Start";
  const actions: ActionMenuItem[] = [
    { id: primaryId, label: primaryTitle, icon: live || connecting ? "stop-circle-outline" : "play-circle-outline" },
    { id: "edit", label: "Edit", icon: "pencil-outline" },
    { id: "remove", label: "Remove", icon: "trash-outline", destructive: true },
  ];
  const onAction = (id: string) => { if (id === "edit") props.onEdit(); else if (id === "remove") props.onRemove(); else primary(); };
  return (
    <View testID={`forwarding-profile-${profile.id}`}>
      <View style={styles.serviceRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${profile.label}, ${status}`} onPress={live ? props.onOpen : props.onEdit} style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}>
          <ServiceIcon name="globe-outline" live={live} />
          <View style={styles.rowText}>
            <View style={styles.rowTitleLine}>
              <Text numberOfLines={1} style={styles.rowTitle}>{profile.label}</Text>
              {(connecting || props.pending) && <ActivityIndicator size={10} color={color} />}
              <Text style={[styles.status, { color }]}>{status}</Text>
            </View>
            <Text numberOfLines={1} style={styles.rowSubtitle}>{`:${profile.remotePort} → phone :${profile.localPort ?? "auto"}`}</Text>
          </View>
        </Pressable>
        {Platform.OS === "web" ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Forwarding actions ${profile.label}`} onPress={props.onToggleWebMenu} style={styles.iconButton}>
            <Ionicons name="ellipsis-vertical" size={18} color={colors.textDim} />
          </Pressable>
        ) : (
          <ActionMenu accessibilityLabel={`Forwarding actions ${profile.label}`} actions={actions} onSelect={onAction} style={styles.menuAnchor}>
            <Pressable accessibilityLabel={`Forwarding actions ${profile.label}`} style={styles.iconButton}><Ionicons name="ellipsis-vertical" size={18} color={colors.textDim} /></Pressable>
          </ActionMenu>
        )}
      </View>
      {Platform.OS === "web" && props.webMenuVisible && (
        <View style={styles.webActions}>
          <SmallAction label={`${primaryTitle} ${profile.label}`} title={primaryTitle} onPress={primary} />
          <SmallAction label={`Edit ${profile.label}`} title="Edit" onPress={props.onEdit} />
          <SmallAction label={`Remove ${profile.label}`} title="Remove" onPress={props.onRemove} danger />
        </View>
      )}
      {errored && profile.error !== null && <Text numberOfLines={2} style={styles.profileError}>{profile.error}</Text>}
    </View>
  );
}

function ManualPortForm(props: {
  serverName: string; form: FormState; submitting: boolean; error: string | null;
  onChange(next: FormState): void; onBack(): void; onSubmit(): void; onRemove?: () => void;
}) {
  const update = (patch: Partial<FormState>) => props.onChange({ ...props.form, ...patch });
  return (
    <View testID="port-forwarding-form" style={styles.root}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to open ports" onPress={props.onBack} style={styles.iconButton}><Ionicons name="arrow-back" size={20} color={colors.text} /></Pressable>
        <View style={styles.titleBlock}><Text style={styles.title}>{props.form.id === null ? "Manual port" : "Edit port"}</Text><Text numberOfLines={1} style={styles.subtitle}>{props.serverName}</Text></View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.formContent}>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput accessibilityLabel="Forwarding name" value={props.form.label} onChangeText={(label) => update({ label })} placeholder="Frontend" placeholderTextColor={colors.textDim} style={styles.textInput} />
        <View style={styles.formGroup}>
          <PortField label="Remote port" hint="server localhost" accessibilityLabel="Remote server port" value={props.form.remotePort} onChange={(remotePort) => update({ remotePort })} />
          <View style={styles.divider} />
          <PortField label="Phone port" hint="automatic if empty" accessibilityLabel="Preferred phone port" value={props.form.localPort} placeholder="Auto" onChange={(localPort) => update({ localPort })} />
          <View style={styles.divider} />
          <View style={styles.switchRow}><View style={styles.rowText}><Text style={styles.rowTitle}>Start now</Text><Text style={styles.rowSubtitle}>Keep available on this phone</Text></View><Switch value={props.form.startImmediately} onValueChange={(startImmediately) => update({ startImmediately })} /></View>
        </View>
        {props.error !== null && <InlineError value={props.error} />}
        <View style={styles.formActions}>
          {props.onRemove !== undefined && <Pressable accessibilityLabel="Remove forwarding" disabled={props.submitting} onPress={props.onRemove} style={styles.removeButton}><Text style={styles.removeText}>Remove</Text></Pressable>}
          <Pressable accessibilityLabel={props.form.id === null ? "Add forwarding" : "Save forwarding"} disabled={props.submitting} onPress={props.onSubmit} style={styles.primaryButton}>
            {props.submitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>{props.form.id === null ? "Add" : "Save"}</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function PortField(props: { label: string; hint: string; accessibilityLabel: string; value: string; placeholder?: string; onChange(value: string): void }) {
  return <View style={styles.portField}><View style={styles.rowText}><Text style={styles.rowTitle}>{props.label}</Text><Text style={styles.rowSubtitle}>{props.hint}</Text></View><TextInput accessibilityLabel={props.accessibilityLabel} keyboardType="number-pad" maxLength={5} value={props.value} placeholder={props.placeholder} placeholderTextColor={colors.textDim} onChangeText={props.onChange} style={styles.portInput} /></View>;
}
function ServiceIcon({ name, live = false }: { name: ComponentProps<typeof Ionicons>["name"]; live?: boolean }) { return <View style={styles.serviceIcon}><Ionicons name={name} size={19} color={colors.textMuted} />{live && <View style={styles.liveDot} />}</View>; }
function SectionLabel({ value }: { value: string }) { return <Text style={styles.sectionLabel}>{value}</Text>; }
function InlineError({ value }: { value: string }) { return <View accessibilityRole="alert" style={styles.inlineError}><Ionicons name="alert-circle-outline" size={16} color={colors.red} /><Text style={styles.errorText}>{value}</Text></View>; }
function InfoRow({ icon, title, subtitle, loading = false }: { icon: ComponentProps<typeof Ionicons>["name"]; title: string; subtitle: string; loading?: boolean }) { return <View style={styles.serviceRow}><ServiceIcon name={icon} /><View style={styles.rowText}><Text style={styles.rowTitle}>{title}</Text><Text numberOfLines={2} style={styles.rowSubtitle}>{subtitle}</Text></View>{loading && <ActivityIndicator size="small" color={colors.textDim} />}</View>; }
function SmallAction({ label, title, danger = false, onPress }: { label: string; title: string; danger?: boolean; onPress(): void }) { return <Pressable accessibilityLabel={label} onPress={onPress} style={styles.smallAction}><Text style={[styles.smallActionText, danger && { color: colors.red }]}>{title}</Text></Pressable>; }

export function parseForwardingDraft(form: Pick<FormState, "label" | "remotePort" | "localPort" | "startImmediately">): PortForwardingDraft {
  const remotePort = parsePort(form.remotePort, "Remote port");
  const preferredLocalPort = form.localPort.trim() === "" ? null : parsePort(form.localPort, "Phone port");
  return { label: form.label.trim() || `Port ${remotePort}`, remoteHost: "127.0.0.1", remotePort, preferredLocalPort, startImmediately: form.startImmediately };
}
function parsePort(raw: string, label: string): number { const port = Number(raw); if (!/^\d{1,5}$/u.test(raw.trim()) || !Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error(`${label} must be between 1 and 65535`); return port; }
function message(cause: unknown, fallback: string): string { return cause instanceof Error ? cause.message : fallback; }
function shortCwd(cwd: string): string { const parts = cwd.split("/").filter(Boolean); return parts.at(-1) ?? cwd; }
function candidateIcon(kind: PortForwardingCandidate["kind"]): ComponentProps<typeof Ionicons>["name"] { if (kind === "web") return "globe-outline"; if (kind === "node") return "logo-nodejs"; if (kind === "python") return "code-slash-outline"; if (kind === "container") return "cube-outline"; return "terminal-outline"; }

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, width: "100%", maxWidth: 560, alignSelf: "center" },
  header: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xs },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { color: colors.text, ...typeScale.titleMedium, fontWeight: "600" },
  subtitle: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  iconButton: { width: touchTarget, height: touchTarget, alignItems: "center", justifyContent: "center", borderRadius: radii.large },
  listContent: { paddingBottom: spacing.md },
  sectionLabel: { marginTop: spacing.sm, marginBottom: 3, paddingHorizontal: spacing.sm, color: colors.textDim, fontSize: 10, lineHeight: 14, letterSpacing: 0.7, fontWeight: "600" },
  serviceRow: { width: "100%", minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radii.selected },
  rowMain: { flex: 1, minWidth: 0, minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  serviceIcon: { width: 38, height: 38, flexShrink: 0, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainerLow, position: "relative" },
  liveDot: { position: "absolute", right: 0, bottom: 1, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.green, borderWidth: 2, borderColor: colors.surface },
  rowText: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  rowTitle: { flexShrink: 1, color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: "500" },
  rowSubtitle: { color: colors.textMuted, fontSize: 12, lineHeight: 16, fontVariant: ["tabular-nums"] },
  status: { flexShrink: 0, fontSize: 10, lineHeight: 14, fontWeight: "500" },
  menuAnchor: { width: touchTarget, height: touchTarget },
  profileError: { marginLeft: 60, marginRight: spacing.md, marginTop: -4, marginBottom: 5, color: colors.red, fontSize: 11, lineHeight: 15 },
  webActions: { minHeight: 38, flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: spacing.sm },
  smallAction: { minHeight: 38, justifyContent: "center", paddingHorizontal: spacing.sm },
  smallActionText: { color: colors.textMuted, ...typeScale.labelMedium },
  formContent: { padding: spacing.sm, gap: spacing.xs },
  fieldLabel: { color: colors.textMuted, ...typeScale.labelMedium },
  textInput: { minHeight: touchTarget, borderRadius: radii.selected, backgroundColor: colors.surfaceContainerLow, color: colors.text, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  formGroup: { marginTop: spacing.xs, overflow: "hidden", borderRadius: radii.selected, backgroundColor: colors.surfaceContainerLow },
  portField: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm },
  portInput: { width: 82, minHeight: touchTarget, color: colors.text, textAlign: "right", fontVariant: ["tabular-nums"], paddingVertical: spacing.xs },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: spacing.sm, backgroundColor: colors.borderSoft },
  switchRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm },
  inlineError: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm },
  errorText: { flex: 1, color: colors.red, ...typeScale.labelMedium },
  formActions: { minHeight: touchTarget, marginTop: spacing.sm, flexDirection: "row", justifyContent: "flex-end", gap: spacing.xs },
  primaryButton: { minWidth: 96, minHeight: touchTarget, paddingVertical: spacing.xs, alignItems: "center", justifyContent: "center", borderRadius: radii.large, backgroundColor: colors.primary },
  primaryText: { color: colors.onPrimary, ...typeScale.labelLarge },
  removeButton: { minHeight: touchTarget, justifyContent: "center", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  removeText: { color: colors.red, ...typeScale.labelLarge },
  rowPressed: { backgroundColor: colors.surfaceHover },
  pressed: { opacity: 0.64 },
});
