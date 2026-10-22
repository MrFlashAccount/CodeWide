import { View } from "react-native";

import type { ForgeAccountsSnapshot, ForgeProvider } from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { AppSwitch } from "../../../ui/AppSwitch";
import { ChecksCredentialStep } from "../onboarding/ChecksCredentialStep";
import { onboardingStyles as styles } from "../onboarding/onboarding.styles";
import { ProviderCard } from "../onboarding/ProviderCard";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";

/**
 * One provider in the Accounts sheet: its enable switch (the rollback switch,
 * which keeps accounts), and while enabled the optional checks credential and
 * a connect card for another account.
 */
export function ProviderSection({
  busy,
  capabilities,
  connectionId,
  onSetEnabled,
  provider,
  snapshot,
}: {
  readonly busy: boolean;
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly onSetEnabled: (provider: ForgeProvider, enabled: boolean) => void;
  readonly provider: ForgeProvider;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  const connect = {
    accounts: snapshot.accounts,
    capabilities,
    connectionId,
    flows: snapshot.flows,
    provider,
  };
  return (
    <View style={styles.section}>
      <ProviderSwitch busy={busy} onSetEnabled={onSetEnabled} provider={provider} />
      {provider.enabled ? (
        <ChecksCredentialStep
          capabilities={capabilities}
          connectionId={connectionId}
          provider={provider}
        />
      ) : null}
      {provider.enabled ? <ProviderCard {...connect} /> : null}
    </View>
  );
}

function ProviderSwitch({
  busy,
  onSetEnabled,
  provider,
}: {
  readonly busy: boolean;
  readonly onSetEnabled: (provider: ForgeProvider, enabled: boolean) => void;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  return (
    <View style={styles.header}>
      <ProductText numberOfLines={1} style={styles.title}>
        {provider.forgeName}
      </ProductText>
      <AppSwitch
        accessibilityLabel={`${provider.forgeName} enabled`}
        disabled={busy}
        onValueChange={(enabled) => {
          onSetEnabled(provider, enabled);
        }}
        value={provider.enabled}
      />
    </View>
  );
}
