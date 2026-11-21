import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";

import type { ForgeAccountsSnapshot, ForgeProvider } from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import { providerInstalled } from "../accounts/accountPresentation";
import { Tray, useTray, type ITrayPalette } from "../../../vendor/reacticx/tray";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { onboardingStyles as styles } from "./onboarding.styles";
import { ProviderJourneyViews } from "./ProviderJourneyViews";
import { ProviderTrayHeader, TrayTrust } from "./ProviderTrayChrome";
import { PROVIDERS_VIEW, PROVIDER_STEP, providerMethodsView } from "./providerTrayNavigation";

const PROVIDER_LIST_MAX_HEIGHT = 440;
const TRAY_PALETTE: Partial<ITrayPalette> = {
  backdrop: colors.scrim,
  border: colors.surfaceContainer,
  handle: colors.textDim,
  mutedText: colors.textMuted,
  surface: colors.surfaceContainer,
  text: colors.text,
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
  const handleOpenChange = useEvent((open: boolean): void => {
    onOpenChange(open);
  });
  return (
    <Tray
      defaultView={PROVIDERS_VIEW}
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
        <ProviderListView snapshot={snapshot} />
        {snapshot.providers.map((provider) => (
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
  snapshot,
}: {
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
          <ProviderRow key={provider.pluginId} provider={provider} />
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

/** One provider: opens its methods, or says why its plugin cannot serve sign-in. */
function ProviderRow({ provider }: { readonly provider: ForgeProvider }): React.JSX.Element {
  const tray = useTray();
  const unavailable = !providerInstalled(provider);
  const onPress = useEvent((): void => {
    if (!unavailable) {
      tray.setView(providerMethodsView(provider.pluginId));
    }
  });
  return (
    <Pressable
      accessibilityHint={unavailable ? undefined : "Show connection methods"}
      accessibilityLabel={provider.forgeName}
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      style={styles.providerRow}
      testID={`forge-provider-row-${provider.pluginId}`}
    >
      <View style={styles.providerRowIcon}>
        <ForgeIcon
          color={unavailable ? colors.textMuted : colors.text}
          icon={provider.icon}
          size={iconSize.navigation}
        />
      </View>
      <View style={styles.providerIdentity}>
        <ProductText numberOfLines={1} style={styles.providerTitle} weight="semibold">
          {provider.forgeName}
        </ProductText>
        <ProviderRowCaption provider={provider} />
      </View>
      {unavailable ? null : (
        <Ionicons color={colors.textMuted} name="chevron-forward" size={iconSize.inline} />
      )}
    </Pressable>
  );
}

const UNAVAILABLE_CAPTION_LINES = 2;

/** The provider's host, or why its plugin cannot serve sign-in. */
function ProviderRowCaption({ provider }: { readonly provider: ForgeProvider }): React.JSX.Element {
  const installation = provider.installation;
  if (installation.state === "missing" || installation.state === "failed") {
    return (
      <ProductText numberOfLines={UNAVAILABLE_CAPTION_LINES} style={styles.providerCaption}>
        {`${installation.state === "missing" ? "Plugin not installed" : "Plugin unavailable"} · ${installation.reason}`}
      </ProductText>
    );
  }
  return (
    <ProductText numberOfLines={1} style={styles.providerCaption}>
      {provider.defaultHost ?? "Host unavailable"}
    </ProductText>
  );
}
