import { View, type ScrollViewProps } from "react-native";

import type { ForgeProvider } from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { AppList } from "../../../ui/AppList";
import { AppListItem } from "../../../ui/AppListItem";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import { providerInstalled } from "../accounts/accountPresentation";
import { onboardingStyles as styles } from "./onboarding.styles";

/** Server-declared providers and their availability for both account entry points. */
export function ProviderChoices({
  onSelect,
  providers,
}: {
  readonly onSelect: (provider: ForgeProvider) => void;
  readonly providers: readonly ForgeProvider[];
}): React.JSX.Element {
  return (
    <>
      <ProductText style={styles.trayIntro}>
        Choose where CodeWide should look for pull requests.
      </ProductText>
      <AppList
        data={providers}
        empty={
          <ProductText style={styles.body}>
            No forge provider is registered on this Companion.
          </ProductText>
        }
        keyExtractor={(provider) => provider.pluginId}
        renderItem={({ item }) => <ProviderRow onSelect={onSelect} provider={item} />}
        scrollComponent={ProviderListGroup}
        virtualized={false}
      />
    </>
  );
}

// Both the Tray and the settings page already own the vertical scroll gesture.
function ProviderListGroup({ children }: ScrollViewProps): React.JSX.Element {
  return <View>{children}</View>;
}

/** One provider: opens its methods, or says why its plugin cannot serve sign-in. */
function ProviderRow({
  onSelect,
  provider,
}: {
  readonly onSelect: (provider: ForgeProvider) => void;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  const unavailable = !providerInstalled(provider);
  const onPress = useEvent((): void => {
    if (!unavailable) {
      onSelect(provider);
    }
  });
  return (
    <AppListItem
      accessibilityLabel={provider.forgeName}
      description={providerCaption(provider)}
      disabled={unavailable}
      leading={
        <ForgeIcon
          color={unavailable ? colors.textMuted : colors.text}
          icon={provider.icon}
          size={iconSize.action}
        />
      }
      multiline={unavailable}
      onPress={onPress}
      testID={`forge-provider-row-${provider.pluginId}`}
      title={provider.forgeName}
      {...(unavailable
        ? {}
        : {
            accessibilityHint: "Show connection methods",
            trailingIcon: { name: "chevron-forward" as const },
          })}
    />
  );
}

function providerCaption(provider: ForgeProvider): string {
  const installation = provider.installation;
  if (installation.state === "missing" || installation.state === "failed") {
    return `${installation.state === "missing" ? "Plugin not installed" : "Plugin unavailable"} · ${installation.reason}`;
  }
  return provider.defaultHost ?? "Host unavailable";
}
