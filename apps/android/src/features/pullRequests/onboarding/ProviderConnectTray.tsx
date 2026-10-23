import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";

import type { ForgeAccountsSnapshot, ForgeProvider } from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { useAppDialog } from "../../../ui/AppDialog";
import { AppText } from "../../../ui/AppText";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import { Tray, useTray, type ITrayMotion, type ITrayPalette } from "../../../vendor/reacticx/tray";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { onboardingStyles as styles } from "./onboarding.styles";
import { ProviderJourneyViews } from "./ProviderJourneyViews";
import { ProviderTrayHeader, TrayTrust } from "./ProviderTrayChrome";
import { PROVIDERS_VIEW, PROVIDER_STEP, providerMethodsView } from "./providerTrayNavigation";

const PROVIDER_LIST_MAX_HEIGHT = 440;
const TRAY_PRESENT_START_SCALE = 0.5;
const TRAY_VIEW_SLIDE = 90;
const TRAY_VIEW_START_SCALE = 1;
const TRAY_PALETTE: Partial<ITrayPalette> = {
  backdrop: colors.scrim,
  border: colors.surfaceContainer,
  handle: colors.textDim,
  mutedText: colors.textMuted,
  surface: colors.surfaceContainer,
  text: colors.text,
};
const TRAY_MOTION: Partial<ITrayMotion> = {
  startScale: TRAY_PRESENT_START_SCALE,
  viewAxis: "x",
  viewSlide: TRAY_VIEW_SLIDE,
  viewStartScale: TRAY_VIEW_START_SCALE,
};

/** Connect CTA and its server-driven provider/auth view stack. */
export function ProviderConnectTray({
  capabilities,
  connectionId,
  onOpenChange,
  snapshot,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  const enabled = snapshot.providers.filter((provider) => provider.enabled);
  const handleOpenChange = useEvent((open: boolean): void => {
    onOpenChange(open);
  });
  return (
    <Tray
      defaultView={PROVIDERS_VIEW}
      motion={TRAY_MOTION}
      onOpenChange={handleOpenChange}
      palette={TRAY_PALETTE}
      theme="dark"
    >
      <Tray.Trigger style={styles.welcomeButton} view={PROVIDERS_VIEW}>
        <Ionicons color={colors.onPrimary} name="add" size={iconSize.action} />
        <ProductText style={styles.welcomeButtonLabel} weight="semibold">
          Connect a provider
        </ProductText>
      </Tray.Trigger>
      <Tray.Content style={styles.traySurface}>
        <ProviderListView
          capabilities={capabilities}
          connectionId={connectionId}
          snapshot={snapshot}
        />
        {enabled.map((provider) => (
          <ProviderJourneyViews
            capabilities={capabilities}
            connectionId={connectionId}
            key={provider.pluginId}
            provider={provider}
            snapshot={snapshot}
          />
        ))}
      </Tray.Content>
    </Tray>
  );
}

function ProviderListView({
  capabilities,
  connectionId,
  snapshot,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  return (
    <Tray.View id={PROVIDERS_VIEW}>
      <ProviderTrayHeader step={PROVIDER_STEP} title="Connect a provider" />
      <Tray.ScrollView
        contentContainerStyle={styles.providerList}
        maxHeight={PROVIDER_LIST_MAX_HEIGHT}
      >
        <ProductText style={styles.trayIntro}>
          Choose where CodeWide should look for pull requests.
        </ProductText>
        {snapshot.providers.map((provider) => (
          <ProviderRow
            capabilities={capabilities}
            connectionId={connectionId}
            key={provider.pluginId}
            provider={provider}
          />
        ))}
        {snapshot.providers.length === 0 ? (
          <ProductText style={styles.body}>
            No forge provider is registered on this Companion.
          </ProductText>
        ) : null}
        <TrayTrust />
      </Tray.ScrollView>
    </Tray.View>
  );
}

function ProviderRow({
  capabilities,
  connectionId,
  provider,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  const dialog = useAppDialog();
  const [enabling, setEnabling] = useState(false);
  const tray = useTray();
  const onPress = useEvent((): void => {
    if (provider.enabled) {
      tray.setView(providerMethodsView(provider.pluginId));
      return;
    }
    if (enabling) {
      return;
    }
    setEnabling(true);
    capabilities.setProviderEnabled(connectionId, provider.pluginId, true).then(
      () => {
        setEnabling(false);
      },
      (error: unknown) => {
        setEnabling(false);
        dialog.error(`Could not enable ${provider.forgeName}`, error);
      },
    );
  });
  return (
    <Pressable
      accessibilityHint={provider.enabled ? "Show connection methods" : "Enable this provider"}
      accessibilityLabel={provider.forgeName}
      accessibilityRole="button"
      disabled={enabling}
      onPress={onPress}
      style={styles.providerRow}
      testID={`forge-provider-row-${provider.pluginId}`}
    >
      <View style={styles.providerRowIcon}>
        <ForgeIcon
          color={provider.enabled ? colors.text : colors.textMuted}
          glyph={provider.icon.glyph}
          iconKey={provider.icon.iconKey}
          size={iconSize.navigation}
        />
      </View>
      <View style={styles.providerIdentity}>
        <ProductText numberOfLines={1} style={styles.providerTitle} weight="semibold">
          {provider.forgeName}
        </ProductText>
        <ProductText numberOfLines={1} style={styles.providerCaption}>
          {provider.defaultHost ?? "Host unavailable"}
        </ProductText>
      </View>
      <View style={styles.providerRowTrailing}>
        {provider.enabled ? null : (
          <AppText shimmering={enabling} style={styles.providerCaption}>
            Enable
          </AppText>
        )}
        <Ionicons color={colors.textMuted} name="chevron-forward" size={iconSize.inline} />
      </View>
    </Pressable>
  );
}
