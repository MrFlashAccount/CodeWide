import { connectionSettingsSections } from "../connections/ConnectionFeature";
/** V1 SettingsFeature owner, extracted without changing interaction or resource lifetime. */
import { useLiveQuery } from "@tanstack/react-db";
import Constants from "expo-constants";
import { useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Platform, Switch, View } from "react-native";
import { UiGenerationControl } from "../../boot/UiGenerationControl";
import { subscribeUiGeneration, uiGenerationSnapshot } from "../../boot/uiGenerationResource";
import type { AccountPoolSnapshot } from "../../data/account-pool";
import type { AccountRateLimitsRow } from "../../data/account-rate-limits";
import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { ConnectionUpdateInput } from "../../data/connection-validation";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { useAppLockSettings } from "../../ui/AppLockGate";
import { ComposerEditorTrialEntry } from "../composer/input/ComposerEditorTrialEntry";
import { PerformanceDiagnostics } from "../diagnostics/PerformanceDiagnostics";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SettingsFeature.styles";
import { SettingsSection, SettingsSheet } from "./SettingsSheet";
import { SettingsVersion } from "./SettingsVersion";

export function SubscribedConnectionSettings({
  accountRateLimitsDatabase,
  ...props
}: Omit<Parameters<typeof ConnectionSettings>[0], "accountRateLimits"> & {
  accountRateLimitsDatabase: AccountRateLimitsDatabase | null;
}) {
  const query = useLiveQuery(
    () => accountRateLimitsDatabase?.collection,
    [accountRateLimitsDatabase],
  );
  return <ConnectionSettings {...props} accountRateLimits={query.data ?? []} />;
}

export function ConnectionSettings({
  accountRateLimits,
  connections,
  onActivateAccountProfile,
  onAddServer,
  onCancelAccountLogin,
  onClose,
  onDelete,
  onMove,
  onReconnect,
  onRefreshAccountPool,
  onRemoveAccountProfile,
  onStartAccountLogin,
  onToggle,
  onUpdate,
  onUpdateAccountProfile,
}: {
  accountRateLimits: AccountRateLimitsRow[];
  connections: StoredConnection[];
  onActivateAccountProfile?: (
    connectionId: string,
    profileId: string,
  ) => Promise<AccountPoolSnapshot>;
  onAddServer: () => void;
  onCancelAccountLogin?: (connectionId: string, loginId: string) => Promise<void>;
  onClose: () => void;
  onDelete: (connectionId: string) => Promise<void>;
  onMove: (connectionId: string, direction: -1 | 1) => Promise<void>;
  onReconnect: (connectionId: string) => Promise<void>;
  onRefreshAccountPool?: (connectionId: string) => Promise<AccountPoolSnapshot>;
  onRemoveAccountProfile?: (
    connectionId: string,
    profileId: string,
  ) => Promise<AccountPoolSnapshot>;
  onStartAccountLogin?: (
    connectionId: string,
  ) => Promise<{ loginId: string; userCode: string; verificationUrl: string }>;
  onToggle: (connectionId: string, enabled: boolean) => Promise<void>;
  onUpdate: (connectionId: string, input: ConnectionUpdateInput) => Promise<void>;
  onUpdateAccountProfile?: (
    connectionId: string,
    profileId: string,
    update: { enabled?: boolean; priority?: number },
  ) => Promise<AccountPoolSnapshot>;
}) {
  const appLock = useAppLockSettings();
  const uiGeneration = useSyncExternalStore(
    subscribeUiGeneration,
    uiGenerationSnapshot,
    uiGenerationSnapshot,
  );
  const [appLockSaving, setAppLockSaving] = useState(false);
  const [appLockError, setAppLockError] = useState<string | null>(null);
  const changeAppLock = useEvent(async (enabled: boolean) => {
    if (appLockSaving) {
      return;
    }
    setAppLockSaving(true);
    setAppLockError(null);
    try {
      await appLock.setEnabled(enabled);
    } catch (error) {
      setAppLockError(error instanceof Error ? error.message : "Could not update app lock");
    }
    setAppLockSaving(false);
  });
  return (
    <SettingsSheet
      advanced={
        <>
          <SettingsSection title="Interface">
            <View testID="ui-generation-setting">
              <AppListRow
                description="Legacy"
                fixedHeight={listRowHeight.double}
                leadingIcon={{
                  color: colors.textMuted,
                  name: "layers-outline",
                  size: iconSize.action,
                }}
                title="Interface"
              />
              {uiGeneration.status === "ready" ? (
                <UiGenerationControl current={uiGeneration.generation} />
              ) : (
                <ActivityIndicator
                  accessibilityLabel="Loading interface generation"
                  color={colors.textMuted}
                  size="small"
                />
              )}
            </View>
          </SettingsSection>
          <SettingsSection title="Experiments">
            <ComposerEditorTrialEntry />
          </SettingsSection>
          <SettingsSection title="Diagnostics">
            <PerformanceDiagnostics />
          </SettingsSection>
        </>
      }
      onAddServer={onAddServer}
      onClose={onClose}
      security={
        Platform.OS === "web" ? null : (
          <View testID="app-lock-setting">
            <AppListRow
              description="Use fingerprint, face or device authentication"
              fixedHeight={listRowHeight.double}
              leadingIcon={{ color: colors.textMuted, name: "finger-print", size: iconSize.action }}
              title="App lock"
              trailing={
                <>
                  {appLockSaving && <ActivityIndicator color={colors.textMuted} size="small" />}
                  <Switch
                    accessibilityLabel="Biometric app lock"
                    disabled={appLockSaving}
                    onValueChange={changeAppLock}
                    value={appLock.enabled}
                  />
                </>
              }
            />
            {appLockError !== null && (
              <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                {appLockError}
              </Text>
            )}
          </View>
        )
      }
      servers={connectionSettingsSections({
        accountRateLimits,
        connections,
        onDelete,
        onMove,
        onReconnect,
        onToggle,
        onUpdate,
        ...(onRefreshAccountPool === undefined ? {} : { onRefreshAccountPool }),
        ...(onStartAccountLogin === undefined ? {} : { onStartAccountLogin }),
        ...(onCancelAccountLogin === undefined ? {} : { onCancelAccountLogin }),
        ...(onActivateAccountProfile === undefined ? {} : { onActivateAccountProfile }),
        ...(onUpdateAccountProfile === undefined ? {} : { onUpdateAccountProfile }),
        ...(onRemoveAccountProfile === undefined ? {} : { onRemoveAccountProfile }),
      })}
      version={<SettingsVersion version={Constants.expoConfig?.version ?? "unknown"} />}
    />
  );
}

/** Keeps settings visibility with its public feature while the workspace retains its lifetime. */
export function useSettingsVisibility() {
  return useState(false);
}
