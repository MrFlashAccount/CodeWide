import { useSelector } from "@legendapp/state/react";
import { useState } from "react";
import { View } from "react-native";

import type { ForgeProvider } from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { checksActions, connectActionKey, type ConnectAction } from "./cardPlan";
import { OtherWays } from "./ConnectActions";
import { onboardingStyles as styles } from "./onboarding.styles";
import {
  onboardingModel,
  providerInteractionKey,
  providerInteractionState,
  startProviderInteraction,
} from "./onboardingModel";

/**
 * Optional second credential that only enables checks (for example an Arc CI
 * token). Without it the provider works and checks show "Unavailable" with
 * the plugin's reason; its actions stay quiet.
 */
export function ChecksCredentialStep({
  capabilities,
  connectionId,
  provider,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly provider: ForgeProvider;
}): React.JSX.Element | null {
  const key = providerInteractionKey(connectionId, `${provider.pluginId}\u0000checks`);
  const host = provider.defaultHost;
  const interaction = useSelector(() => providerInteractionState(onboardingModel[key]?.get()));
  const [startedKey, setStartedKey] = useState<string | null>(null);
  const onCheckAgain = useEvent((): void => {
    startProviderInteraction(key, "checking", async () => capabilities.checkAgain(connectionId));
  });
  const onAction = useEvent((action: ConnectAction): void => {
    if (host !== null && (action.kind === "link" || action.kind === "hostLogin")) {
      const login = action.kind === "link" ? action.login : null;
      setStartedKey(connectActionKey(action));
      startProviderInteraction(key, "starting", async () =>
        capabilities.startAuth(connectionId, {
          host,
          login,
          methodId: action.method.methodId,
          pluginId: provider.pluginId,
        }),
      );
    }
  });
  const actions = checksActions(provider);
  if (provider.checksCredential !== "missing" || actions.length === 0) {
    return null;
  }
  return (
    <View style={styles.section} testID={`forge-checks-step-${provider.pluginId}`}>
      <ProductText style={[styles.step, styles.weightMedium]}>Enable checks (optional)</ProductText>
      <OtherWays
        actions={actions}
        handlers={{
          busy: host === null || interaction.pending !== null,
          checking: interaction.pending === "checking",
          onAction,
          onCheckAgain,
          startingKey: interaction.pending === "starting" ? startedKey : null,
        }}
      />
    </View>
  );
}
