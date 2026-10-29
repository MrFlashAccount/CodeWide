import { useSelector } from "@legendapp/state/react";
import { useEffect, useState } from "react";

import type {
  AccountState,
  AuthFlow,
  AuthMethod,
  AuthStartResult,
  ForgeAccountsSnapshot,
  ForgeProvider,
} from "../../../data/forgeContract";
import { useEvent } from "../../../react/useEvent";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { connectActionKey, type ConnectAction } from "./cardPlan";
import type { ConnectHandlers } from "./ConnectActions";
import {
  onboardingModel,
  providerInteractionKey,
  providerInteractionState,
  settleProviderInteraction,
  startProviderInteraction,
} from "./onboardingModel";
import { activeFlow } from "./providerPresentation";

/** Where one provider's sign-in journey is: choosing a method, or authenticating with one. */
type JourneyState =
  | { readonly kind: "idle" }
  | {
      readonly action: ConnectAction | null;
      /** Provider accounts already connected when authentication began. */
      readonly connectedBefore: ReadonlySet<string>;
      readonly flow: AuthFlow | null;
      readonly kind: "auth";
    };

/** How the surface that hosts the journey (Tray views or one sheet) moves between its steps. */
export type JourneyNavigation = {
  /** Whether the authentication step for `authKey` (`null`: the recovered flow) is visible now. */
  readonly isAuthenticationVisible: (authKey: string | null) => boolean;
  /** The flow was cancelled: return to method selection. */
  readonly onCancelled: () => void;
  /** An account is linked. */
  readonly onComplete: () => void;
  /** Reveal the authentication step of a chosen action. */
  readonly onShowAuthentication: (action: ConnectAction) => void;
};

/** State and intents of one provider's sign-in journey, independent of its presentation. */
export type ProviderJourney = {
  /** Key of the authentication step, or `null` for a recovered Companion-owned flow. */
  readonly authKey: string | null;
  readonly cancel: () => void;
  readonly cancelling: boolean;
  readonly checkAgain: () => void;
  readonly checking: boolean;
  readonly error: string | null;
  readonly flow: AuthFlow | null;
  readonly handlers: ConnectHandlers;
  readonly journey: JourneyState;
  readonly reset: () => void;
  readonly retry: (method: AuthMethod, login: string | null) => void;
  readonly starting: boolean;
  readonly submitToken: (token: string) => Promise<void>;
};

/**
 * Binds one provider's methods to the Companion. A live host-login flow is
 * Companion-owned and re-read from the accounts snapshot, so it survives app
 * restarts and lost mutation replies; pending and error state live in the
 * onboarding model.
 */
export function useProviderJourney({
  capabilities,
  connectionId,
  navigation,
  provider,
  snapshot,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly navigation: JourneyNavigation;
  readonly provider: ForgeProvider;
  readonly snapshot: ForgeAccountsSnapshot;
}): ProviderJourney {
  const interactionKey = providerInteractionKey(connectionId, provider.pluginId);
  const interaction = useSelector(() =>
    providerInteractionState(onboardingModel[interactionKey]?.get()),
  );
  const recoveredFlow = activeFlow(provider, snapshot.flows);
  const connectedNow = connectedProviderAccounts(snapshot.accounts, provider);
  const [journey, setJourney] = useState<JourneyState>(() =>
    recoveredFlow === null
      ? { kind: "idle" }
      : { action: null, connectedBefore: connectedNow, flow: recoveredFlow, kind: "auth" },
  );
  const flow = journeyFlow(journey, recoveredFlow);
  const authKey =
    journey.kind === "auth" && journey.action !== null ? connectActionKey(journey.action) : null;
  const complete = useEvent((): void => {
    navigation.onComplete();
  });
  // Completion is an account that became connected during this journey, so
  // adding a second account is not completed by the first one.
  const newlyConnected =
    journey.kind === "auth" && hasNewMember(connectedNow, journey.connectedBefore);
  const authenticationActive = navigation.isAuthenticationVisible(authKey);
  useEffect(() => {
    if (flow !== null) {
      // A reconnect can deliver the Companion-owned flow even when the
      // original mutation response was lost. The authoritative flow settles
      // the local pending marker and immediately restores its code/actions.
      settleProviderInteraction(interactionKey);
    }
    // A host-login completion arrives through the live accounts resource, not
    // through the original start request. Keep that external state in sync with
    // the already-open journey so its terminal step remains visible.
    if (authenticationActive && newlyConnected) {
      complete();
    }
  }, [authenticationActive, complete, newlyConnected, flow, interactionKey]);

  const start = useEvent(
    (action: ConnectAction, login: string | null, method: AuthMethod): void => {
      const host = provider.defaultHost;
      if (host === null) {
        return;
      }
      startProviderInteraction({
        key: interactionKey,
        onSuccess: (result: AuthStartResult) => {
          if (result.kind === "connected") {
            complete();
          } else {
            setJourney((current) => ({
              action,
              connectedBefore: current.kind === "auth" ? current.connectedBefore : connectedNow,
              flow: result.flow,
              kind: "auth",
            }));
          }
        },
        operation: async () =>
          capabilities.startAuth(connectionId, {
            host,
            login,
            methodId: method.methodId,
            pluginId: provider.pluginId,
          }),
        pending: "starting",
      });
    },
  );
  const onAction = useEvent((action: ConnectAction): void => {
    setJourney({ action, connectedBefore: connectedNow, flow: null, kind: "auth" });
    navigation.onShowAuthentication(action);
    if (action.kind === "link") {
      start(action, action.login, action.method);
    } else if (action.kind === "hostLogin" && recoveredFlow?.methodId !== action.method.methodId) {
      start(action, null, action.method);
    }
  });
  const checkAgain = useEvent((): void => {
    startProviderInteraction({
      key: interactionKey,
      operation: async () => capabilities.checkAgain(connectionId),
      pending: "checking",
    });
  });
  const cancel = useEvent((): void => {
    if (flow === null) {
      return;
    }
    startProviderInteraction({
      key: interactionKey,
      onSuccess: () => {
        setJourney({ kind: "idle" });
        navigation.onCancelled();
      },
      operation: async () => capabilities.cancelAuth(connectionId, flow.flowId),
      pending: "cancelling",
    });
  });
  const retry = useEvent((method: AuthMethod, login: string | null): void => {
    const action = actionForMethod(method, login);
    if (action !== null) {
      setJourney({ action, connectedBefore: connectedNow, flow: null, kind: "auth" });
      start(action, login, method);
    }
  });
  const submitToken = useEvent(async (token: string): Promise<void> => {
    const host = provider.defaultHost;
    if (host === null) {
      throw new Error("The provider host is unknown");
    }
    await capabilities.submitToken(connectionId, {
      host,
      pluginId: provider.pluginId,
      token,
    });
    complete();
  });
  const reset = useEvent((): void => {
    setJourney({ kind: "idle" });
  });
  return {
    authKey,
    cancel,
    cancelling: interaction.pending === "cancelling",
    checkAgain,
    checking: interaction.pending === "checking",
    error: interaction.error,
    flow,
    handlers: {
      busy: interaction.pending !== null || provider.defaultHost === null,
      checking: interaction.pending === "checking",
      onAction,
      onCheckAgain: checkAgain,
      startingKey: interaction.pending === "starting" ? authKey : null,
    },
    journey,
    reset,
    retry,
    starting: interaction.pending === "starting",
    submitToken,
  };
}

/** Logins already linked for the provider's own host; they are not offered again. */
export function linkedProviderLogins(
  accounts: readonly AccountState[],
  provider: ForgeProvider,
): ReadonlySet<string> {
  const logins = new Set<string>();
  for (const account of accounts) {
    if (account.pluginId === provider.pluginId && account.host === provider.defaultHost) {
      logins.add(account.login);
    }
  }
  return logins;
}

function connectedProviderAccounts(
  accounts: readonly AccountState[],
  provider: ForgeProvider,
): ReadonlySet<string> {
  const connected = new Set<string>();
  for (const account of accounts) {
    if (
      account.pluginId === provider.pluginId &&
      account.host === provider.defaultHost &&
      account.state === "connected"
    ) {
      connected.add(account.account);
    }
  }
  return connected;
}

function hasNewMember(current: ReadonlySet<string>, before: ReadonlySet<string>): boolean {
  for (const member of current) {
    if (!before.has(member)) {
      return true;
    }
  }
  return false;
}

function journeyFlow(journey: JourneyState, recoveredFlow: AuthFlow | null): AuthFlow | null {
  if (journey.kind !== "auth") {
    return null;
  }
  if (journey.flow !== null) {
    return journey.flow;
  }
  if (journey.action === null || journey.action.method.methodId === recoveredFlow?.methodId) {
    return recoveredFlow;
  }
  return null;
}

function actionForMethod(method: AuthMethod, login: string | null): ConnectAction | null {
  if (method.kind === "linkExisting") {
    return login === null ? null : { kind: "link", login, method };
  }
  return { kind: method.kind, method };
}

/** Title of the authentication step for the chosen action or live flow. */
export function authenticationTitle(provider: ForgeProvider, journey: ProviderJourney): string {
  if (journey.flow !== null) {
    return `Sign in to ${provider.forgeName}`;
  }
  const action = journey.journey.kind === "auth" ? journey.journey.action : null;
  return action?.kind === "pasteToken" ? action.method.label : `Connect ${provider.forgeName}`;
}
