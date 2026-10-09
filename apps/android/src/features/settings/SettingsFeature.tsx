import { connectionSettingsSections } from "../connections/ConnectionFeature";
/** V1 SettingsFeature owner, extracted without changing interaction or resource lifetime. */
import { useSelector } from "@legendapp/state/react";
import { useLiveQuery } from "@tanstack/react-db";
import Constants from "expo-constants";
import { useState } from "react";
import { Platform } from "react-native";
import type { AccountPoolSnapshot, AccountResetCreditConsumption } from "../../data/account-pool";
import type { AccountRateLimitsRow } from "../../data/account-rate-limits";
import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { ConnectionUpdateInput } from "../../data/connection-validation";
import type { HostUpdateView } from "../connections/connectionSettingsContract";
import type { GlobalVoiceName } from "../../data/globalVoicePreferences";
import type { VoiceAssistantModelCatalog } from "../../data/voiceAssistantModelCatalog";
import { hasCustomVoiceAssistantPersonality } from "../../data/voiceAssistantPersonality";
import { useEvent } from "../../react/useEvent";
import { PerformanceDiagnostics } from "../diagnostics/PerformanceDiagnostics";
import { SecuritySettings } from "./SecuritySettings";
import { SettingsSection, SettingsSheet } from "./SettingsSheet";
import { SettingsVersion } from "./SettingsVersion";
import { TimelineRowMeasurementSettings } from "./TimelineRowMeasurementSettings";
import { VoiceAssistantSettings } from "./VoiceAssistantSettings";
import { globalVoiceLabel } from "./globalVoicePresentation";
import { useGlobalVoicePreference } from "./useGlobalVoicePreference";
import { useGlobalVoiceOrbStyle } from "./useGlobalVoiceOrbStyle";
import { usePersonalVoiceFilter } from "./usePersonalVoiceFilter";
import { useVoiceAssistantPersonality } from "./useVoiceAssistantPersonality";
import { useVoiceAssistantBackgroundModel } from "./useVoiceAssistantBackgroundModel";

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
  entryPage = "overview",
  entryRequest,
  hostUpdates,
  onActivateAccountProfile,
  onAddServer,
  onApplyHostUpdate,
  onApplyRelayUpdate,
  onCancelAccountLogin,
  onCheckHostUpdate,
  onCheckRelayUpdate,
  onClose,
  onConsumeAccountResetCredit,
  onDelete,
  onPreviewGlobalVoice,
  onReconnect,
  onRefreshAccountPool,
  onRemoveAccountProfile,
  onStartAccountLogin,
  onToggle,
  onUpdate,
  onUpdateAccountProfile,
  relayUpdates,
  visible,
  voiceAssistantModelCatalog,
}: {
  accountRateLimits: AccountRateLimitsRow[];
  connections: StoredConnection[];
  entryPage?: "overview" | "voiceAssistant";
  entryRequest?: string;
  hostUpdates: Readonly<Record<string, HostUpdateView>>;
  onActivateAccountProfile?: (
    connectionId: string,
    profileId: string,
  ) => Promise<AccountPoolSnapshot>;
  onAddServer: () => void;
  onApplyHostUpdate: (connectionId: string, targetFingerprint: string) => Promise<void>;
  onApplyRelayUpdate: (connectionId: string, targetFingerprint: string) => Promise<void>;
  onCancelAccountLogin?: (connectionId: string, loginId: string) => Promise<void>;
  onCheckHostUpdate: (connectionId: string) => Promise<void>;
  onCheckRelayUpdate: (connectionId: string) => Promise<void>;
  onClose: () => void;
  onConsumeAccountResetCredit?: (
    connectionId: string,
    profileId: string,
    creditId: string | null,
  ) => Promise<AccountResetCreditConsumption>;
  onDelete: (connectionId: string) => Promise<void>;
  onPreviewGlobalVoice: (voice: GlobalVoiceName) => Promise<void>;
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
  relayUpdates: Readonly<Record<string, HostUpdateView>>;
  visible: boolean;
  voiceAssistantModelCatalog: VoiceAssistantModelCatalog;
}) {
  const voicePreference = useGlobalVoicePreference();
  const voiceOrbStyle = useGlobalVoiceOrbStyle();
  const voiceAssistantPersonality = useVoiceAssistantPersonality();
  const voiceAssistantModels = useSelector(() => voiceAssistantModelCatalog.snapshot$.value.get());
  const voiceAssistantBackgroundModel = useVoiceAssistantBackgroundModel(voiceAssistantModels);
  const personalVoiceFilter = usePersonalVoiceFilter();
  const openVoiceAssistantSettings = useEvent(() => {
    voiceAssistantModelCatalog.refresh().catch(() => undefined);
  });
  return (
    <SettingsSheet
      entryPage={entryPage}
      {...(entryRequest === undefined ? {} : { entryRequest })}
      advanced={
        <>
          <SettingsSection title="Experiments">
            <TimelineRowMeasurementSettings />
          </SettingsSection>
          <SettingsSection title="Diagnostics">
            <PerformanceDiagnostics />
          </SettingsSection>
        </>
      }
      onAddServer={onAddServer}
      onClose={onClose}
      security={Platform.OS === "web" ? null : <SecuritySettings />}
      servers={connectionSettingsSections({
        accountRateLimits,
        connections,
        hostUpdates,
        onApplyHostUpdate,
        onApplyRelayUpdate,
        onCheckHostUpdate,
        onCheckRelayUpdate,
        onDelete,
        onReconnect,
        onToggle,
        onUpdate,
        relayUpdates,
        ...(onRefreshAccountPool === undefined ? {} : { onRefreshAccountPool }),
        ...(onStartAccountLogin === undefined ? {} : { onStartAccountLogin }),
        ...(onCancelAccountLogin === undefined ? {} : { onCancelAccountLogin }),
        ...(onConsumeAccountResetCredit === undefined ? {} : { onConsumeAccountResetCredit }),
        ...(onActivateAccountProfile === undefined ? {} : { onActivateAccountProfile }),
        ...(onUpdateAccountProfile === undefined ? {} : { onUpdateAccountProfile }),
        ...(onRemoveAccountProfile === undefined ? {} : { onRemoveAccountProfile }),
      })}
      version={<SettingsVersion version={Constants.expoConfig?.version ?? "unknown"} />}
      visible={visible}
      voiceAssistant={{
        content: (
          <VoiceAssistantSettings
            backgroundModelCatalog={voiceAssistantModels}
            onEnrollPersonalVoice={personalVoiceFilter.enroll}
            onPreviewVoice={onPreviewGlobalVoice}
            onRefreshBackgroundModels={voiceAssistantModelCatalog.refresh}
            onSavePersonality={voiceAssistantPersonality.savePersonality}
            onSelectBackgroundModel={voiceAssistantBackgroundModel.selectModelSettings}
            onSelectOrbStyle={voiceOrbStyle.selectStyle}
            onSelectVoice={voicePreference.selectVoice}
            onSetPersonalVoiceFilterEnabled={personalVoiceFilter.setEnabled}
            personality={voiceAssistantPersonality.personality}
            personalVoiceFilterEnabled={personalVoiceFilter.enabled}
            personalVoiceProfileAvailable={personalVoiceFilter.hasProfile}
            selectedBackgroundEffort={voiceAssistantBackgroundModel.selectedEffort}
            selectedBackgroundModel={voiceAssistantBackgroundModel.selectedModel}
            selectedOrbStyle={voiceOrbStyle.selectedStyle}
            selectedVoice={voicePreference.selectedVoice}
          />
        ),
        description: `${globalVoiceLabel(voicePreference.selectedVoice)} · ${
          voiceOrbStyle.selectedStyle === "particles" ? "Particles" : "Nebula"
        } · ${
          hasCustomVoiceAssistantPersonality(voiceAssistantPersonality.personality)
            ? "Custom personality"
            : "Default personality"
        }`,
        onOpen: openVoiceAssistantSettings,
      }}
    />
  );
}

/** Keeps settings visibility with its public feature while the workspace retains its lifetime. */
export function useSettingsVisibility() {
  return useState(false);
}
