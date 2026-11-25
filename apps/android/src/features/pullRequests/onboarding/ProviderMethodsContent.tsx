import { View } from "react-native";
import type { AccountState, ForgeProvider } from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { methodsPlan } from "./cardPlan";
import { ChecksCredentialStep } from "./ChecksCredentialStep";
import type { ConnectHandlers } from "./ConnectActions";
import { onboardingStyles as styles } from "./onboarding.styles";
import { InteractionError } from "./ProviderAuthenticationPanel";
import { accountMethods, providerExplanation } from "./providerPresentation";
import { TrayConnectMethods } from "./TrayConnectMethods";
import { linkedProviderLogins } from "./useProviderJourney";

/** Method choices and additional credentials shared by catalog and settings. */
export function ProviderMethodsContent({
  accounts,
  capabilities,
  connectionId,
  error,
  handlers,
  provider,
}: {
  readonly accounts: readonly AccountState[];
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly error: string | null;
  readonly handlers: ConnectHandlers;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  return (
    <>
      <View style={styles.providerPanel} testID={`forge-provider-card-${provider.pluginId}`}>
        <ProductText style={styles.trayIntro}>{providerExplanation(provider)}</ProductText>
        {accountMethods(provider).length === 0 ? (
          <ProductText style={styles.body}>
            The Companion reports no sign-in methods for this provider right now.
          </ProductText>
        ) : (
          <TrayConnectMethods
            handlers={handlers}
            plan={methodsPlan(provider, linkedProviderLogins(accounts, provider))}
            provider={provider}
          />
        )}
        <InteractionError error={error} />
      </View>
      <ChecksCredentialStep
        capabilities={capabilities}
        connectionId={connectionId}
        provider={provider}
      />
    </>
  );
}
