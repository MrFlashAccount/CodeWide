import { ScrollView, View } from "react-native";

import type { ForgeAccountsSnapshot } from "../../../data/forgeContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { onboardingStyles as styles } from "./onboarding.styles";
import { ProviderCard } from "./ProviderCard";

/**
 * Pull requests tab with no linked account: one card per enabled provider.
 * Disabled providers stay listed with Enable, because the tab is always present.
 */
export function OnboardingScreen({
  capabilities,
  connectionId,
  snapshot,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  const enabled = snapshot.providers.filter((provider) => provider.enabled);
  const disabled = snapshot.providers.filter((provider) => !provider.enabled);
  return (
    <ScrollView contentContainerStyle={styles.list} testID="forge-onboarding">
      <ProductText accessibilityRole="header" style={styles.title}>
        Connect a forge account
      </ProductText>
      <ProductText style={styles.body}>
        Pull requests from every connected account appear here. Sign-in and tokens stay on the
        companion host.
      </ProductText>
      {enabled.map((provider) => (
        <ProviderCard
          accounts={snapshot.accounts}
          capabilities={capabilities}
          connectionId={connectionId}
          flows={snapshot.flows}
          key={provider.pluginId}
          provider={provider}
        />
      ))}
      {disabled.map((provider) => (
        <View key={provider.pluginId} style={[styles.card, styles.header]}>
          <ProductText numberOfLines={1} style={styles.title}>
            {`${provider.forgeName} · Disabled`}
          </ProductText>
          <AppButton
            onPress={() =>
              void capabilities.setProviderEnabled(connectionId, provider.pluginId, true)
            }
            size="sm"
            variant="secondary"
          >
            Enable
          </AppButton>
        </View>
      ))}
      {snapshot.providers.length === 0 ? (
        <ProductText style={styles.body}>
          No forge provider is registered on this companion.
        </ProductText>
      ) : null}
    </ScrollView>
  );
}
