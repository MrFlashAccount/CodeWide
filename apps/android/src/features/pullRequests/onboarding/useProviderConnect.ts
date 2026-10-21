import type { AuthFlow, AuthMethod, ForgeProvider } from "../../../data/forgeContract";
import { useEvent } from "../../../react/useEvent";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { startProviderInteraction } from "./onboardingModel";

/** Connect intents of one provider card; each records its pending state in the onboarding model. */
export type ProviderConnect = {
  readonly cancel: () => void;
  readonly checkAgain: () => void;
  readonly start: (method: AuthMethod, login: string | null) => void;
  readonly submitToken: (token: string) => Promise<void>;
};

/**
 * Binds a provider card's methods to the companion. Without a known host the
 * card cannot start anything; the token goes straight to `submitToken`.
 */
export function useProviderConnect({
  capabilities,
  connectionId,
  flow,
  host,
  interactionKey,
  provider,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly flow: AuthFlow | null;
  readonly host: string | null;
  readonly interactionKey: string;
  readonly provider: ForgeProvider;
}): ProviderConnect {
  const start = useEvent((method: AuthMethod, login: string | null): void => {
    if (host !== null) {
      startProviderInteraction(interactionKey, "starting", async () =>
        capabilities.startAuth(connectionId, {
          host,
          login,
          methodId: method.methodId,
          pluginId: provider.pluginId,
        }),
      );
    }
  });
  const cancel = useEvent((): void => {
    if (flow !== null) {
      startProviderInteraction(interactionKey, "cancelling", async () =>
        capabilities.cancelAuth(connectionId, flow.flowId),
      );
    }
  });
  const checkAgain = useEvent((): void => {
    startProviderInteraction(interactionKey, "checking", async () =>
      capabilities.checkAgain(connectionId),
    );
  });
  const submitToken = useEvent(async (token: string): Promise<void> => {
    if (host === null) {
      throw new Error("The provider host is unknown");
    }
    await capabilities.submitToken(connectionId, { host, pluginId: provider.pluginId, token });
  });
  return { cancel, checkAgain, start, submitToken };
}
