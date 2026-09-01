import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  Switch,
  View,
} from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";
import {
  PresentationSheetScrollView,
  PresentationSheetView,
} from "../surfaces/PresentationSheetView";
import { ProductText } from "../text/ProductText";

export interface ConnectionSettingsServerRow {
  detail: string;
  emoji: string;
  enabled: boolean;
  id: string;
  label: string;
  pending?: boolean;
  state: "connected" | "connecting" | "disabled" | "error";
}

interface ConnectionSettingsViewProps {
  appLockBusy: boolean;
  appLockEnabled: boolean;
  error: string | null;
  generationControl: ReactNode;
  onAppLockChange(enabled: boolean): void;
  onClose(): void;
  onServerAction(id: string, action: ConnectionSettingsServerAction): void;
  onServerEnabledChange(id: string, enabled: boolean): void;
  servers: ConnectionSettingsServerRow[];
  version: string;
}

export type ConnectionSettingsServerAction =
  | "delete"
  | "edit"
  | "moveDown"
  | "moveUp"
  | "reconnect";

interface SettingsSectionProps {
  children: ReactNode;
  title: string;
}

interface SettingsControlRowProps {
  children?: ReactNode;
  detail: string;
  icon: PresentationIconName;
  title: string;
}

interface SettingsServerRowProps {
  onAction(id: string, action: ConnectionSettingsServerAction): void;
  onEnabledChange(id: string, enabled: boolean): void;
  row: ConnectionSettingsServerRow;
}

export function ConnectionSettingsView(props: ConnectionSettingsViewProps): React.JSX.Element {
  const {
    appLockBusy,
    appLockEnabled,
    error,
    generationControl,
    onAppLockChange,
    onClose,
    onServerAction,
    onServerEnabledChange,
    servers,
    version,
  } = props;
  const handleOpenChange = useEvent((isOpen: boolean) => {
    if (!isOpen) onClose();
  });
  return (
    <PresentationSheetView
      contentProps={{
        enableDynamicSizing: false,
        enableOverDrag: false,
        index: 0,
        snapPoints: ["65%", "90%"],
      }}
      isOpen
      onOpenChange={handleOpenChange}
    >
      <View style={styles.header}>
        <ProductText style={styles.title} weight="semibold">
          Settings
        </ProductText>
        <Pressable accessibilityLabel="Close server settings" onPress={onClose} style={iconStyle}>
          <PresentationIcon color={colors.text} name="close" size={21} />
        </Pressable>
      </View>
      <PresentationSheetScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
        <SettingsSection title="Security">
          <SettingsControlRow
            detail="Require fingerprint, face, or device authentication when opening CodeWide"
            icon="fingerprint"
            title="Biometric app lock"
          >
            {appLockBusy ? <ActivityIndicator color={colors.textMuted} size="small" /> : null}
            <Switch
              accessibilityLabel="Biometric app lock"
              disabled={appLockBusy}
              onValueChange={onAppLockChange}
              value={appLockEnabled}
            />
          </SettingsControlRow>
        </SettingsSection>
        <SettingsSection title="Interface">
          <SettingsControlRow
            detail="Switch between Legacy and V2. The app restarts after selection."
            icon="layers"
            title="Interface generation"
          />
          {generationControl}
        </SettingsSection>
        {error === null ? null : (
          <ProductText accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </ProductText>
        )}
        {servers.length === 0 ? (
          <ProductText style={styles.empty} tone="muted">
            No saved servers
          </ProductText>
        ) : (
          servers.map((row) => (
            <SettingsServerRow
              key={row.id}
              onAction={onServerAction}
              onEnabledChange={onServerEnabledChange}
              row={row}
            />
          ))
        )}
        <ProductText selectable style={styles.version} tone="dim">
          Version {version}
        </ProductText>
      </PresentationSheetScrollView>
    </PresentationSheetView>
  );
}

function SettingsSection(props: SettingsSectionProps): React.JSX.Element {
  const { children, title } = props;
  return (
    <View style={styles.section}>
      <ProductText style={styles.sectionTitle} tone="muted" weight="semibold">
        {title}
      </ProductText>
      {children}
    </View>
  );
}

function SettingsControlRow(props: SettingsControlRowProps): React.JSX.Element {
  const { children, detail, icon, title } = props;
  return (
    <View style={styles.controlRow}>
      <View style={styles.controlIcon}>
        <PresentationIcon color={colors.textMuted} name={icon} size={21} />
      </View>
      <View style={styles.copy}>
        <ProductText style={styles.controlTitle}>{title}</ProductText>
        <ProductText style={styles.controlDetail} tone="muted">
          {detail}
        </ProductText>
      </View>
      {children}
    </View>
  );
}

function SettingsServerRow(props: SettingsServerRowProps): React.JSX.Element {
  const { onAction, onEnabledChange, row } = props;
  const actions: readonly ActionMenuItem[] = [
    { disabled: !row.enabled, icon: "refresh", id: "reconnect", label: "Reconnect" },
    { icon: "pencil-outline", id: "edit", label: "Edit server" },
    { icon: "arrow-up", id: "moveUp", label: "Move up" },
    { icon: "arrow-down", id: "moveDown", label: "Move down" },
    { destructive: true, icon: "trash-outline", id: "delete", label: "Delete server" },
  ];
  const selectAction = useEvent((action: string) => {
    if (isConnectionSettingsServerAction(action)) onAction(row.id, action);
  });
  const changeEnabled = useEvent((enabled: boolean) => onEnabledChange(row.id, enabled));
  return (
    <View style={styles.serverEditor}>
      <View style={styles.serverRow}>
        <ProductText style={styles.serverEmoji}>{row.emoji}</ProductText>
        <View style={styles.copy}>
          <ProductText numberOfLines={1} style={styles.controlTitle}>
            {row.label}
          </ProductText>
          <ProductText numberOfLines={1} style={styles.controlDetail} tone="muted">
            {row.detail}
          </ProductText>
          <View style={styles.stateRow}>
            {row.pending === true ? (
              <ActivityIndicator color={stateColor(row.state)} size={11} />
            ) : (
              <View style={[styles.stateDot, { backgroundColor: stateColor(row.state) }]} />
            )}
            <ProductText style={[styles.stateText, { color: stateColor(row.state) }]}>
              {stateLabel(row.state)}
            </ProductText>
          </View>
        </View>
        <Switch
          accessibilityLabel={`Enable ${row.label}`}
          disabled={row.pending}
          onValueChange={changeEnabled}
          value={row.enabled}
        />
        <ActionMenu
          accessibilityLabel={`Actions for ${row.label}`}
          actions={actions}
          onSelect={selectAction}
          style={styles.menuAnchor}
        >
          <Pressable accessibilityLabel={`Actions for ${row.label}`} style={iconStyle}>
            <PresentationIcon color={colors.textMuted} name="more" size={20} />
          </Pressable>
        </ActionMenu>
      </View>
    </View>
  );
}

function isConnectionSettingsServerAction(value: string): value is ConnectionSettingsServerAction {
  return (
    value === "delete" ||
    value === "edit" ||
    value === "moveDown" ||
    value === "moveUp" ||
    value === "reconnect"
  );
}

function stateColor(state: ConnectionSettingsServerRow["state"]): string {
  if (state === "connected") return colors.green;
  if (state === "connecting") return colors.amber;
  if (state === "error") return colors.red;
  return colors.textDim;
}

function stateLabel(state: ConnectionSettingsServerRow["state"]): string {
  if (state === "connected") return "Connected";
  if (state === "connecting") return "Connecting";
  if (state === "error") return "Connection error";
  return "Disabled";
}

function iconStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.iconButton, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  controlDetail: { ...typeScale.label, marginTop: spacing.optical },
  controlIcon: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  controlRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
  },
  controlTitle: typeScale.title,
  copy: { flex: 1, minWidth: 0 },
  empty: { paddingVertical: spacing.md },
  error: { color: colors.red, ...typeScale.body, paddingVertical: spacing.sm },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingBottom: spacing.xs,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.medium,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  menuAnchor: { flexShrink: 0, height: touchTarget, width: touchTarget },
  pressed: { opacity: 0.68 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { paddingBottom: spacing.sm },
  section: {
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    ...typeScale.label,

    paddingBottom: spacing.xs,
    paddingTop: spacing.xs,
    textTransform: "uppercase",
  },
  serverEditor: { borderBottomColor: colors.borderSoft, borderBottomWidth: 1 },
  serverEmoji: { ...typeScale.emoji },
  serverRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 72,
    paddingVertical: spacing.xs,
  },
  stateDot: { borderRadius: 4, height: 7, width: 7 },
  stateRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xxs,
    minHeight: 18,
    minWidth: 0,
  },
  stateText: { flexShrink: 1, ...typeScale.caption, fontWeight: typeWeight.semibold },
  title: { flex: 1, minWidth: 0, ...typeScale.heading },
  version: {
    ...typeScale.caption,

    paddingBottom: spacing.sm,
    paddingTop: spacing.lg,
    textAlign: "center",
  },
});
