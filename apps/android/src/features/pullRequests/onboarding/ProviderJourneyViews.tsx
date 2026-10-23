import { useSelector } from "@legendapp/state/react";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { View } from "react-native";

import type {
  AccountState,
  AuthFlow,
  AuthMethod,
  AuthStartResult,
  ForgeAccountsSnapshot,
  ForgeProvider,
} from "../../../data/forgeContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { AppText } from "../../../ui/AppText";
import { Tray, useTray } from "../../../vendor/reacticx/tray";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { connectActionKey, methodsPlan, type ConnectAction } from "./cardPlan";
import type { ConnectHandlers } from "./ConnectActions";
import { FlowPanel } from "./FlowPanel";
import { InstructionsPanel } from "./InstructionsPanel";
import { onboardingStyles as styles } from "./onboarding.styles";
import {
  onboardingModel,
  providerInteractionKey,
  providerInteractionState,
  settleProviderInteraction,
  startProviderInteraction,
} from "./onboardingModel";
import {
  AUTHENTICATION_STEP,
  METHOD_STEP,
  PROVIDERS_VIEW,
  SUCCESS_STEP,
  providerAuthActionView,
  providerAuthView,
  providerMethodsView,
  providerSuccessView,
} from "./providerTrayNavigation";
import { ProviderTrayHeader, TrayTrust } from "./ProviderTrayChrome";
import { accountMethods, activeFlow, providerExplanation } from "./providerPresentation";
import { TrayConnectMethods } from "./TrayConnectMethods";
import { TrayTokenPanel } from "./TrayTokenPanel";

type JourneyState =
  | { readonly kind: "idle" }
  | {
      readonly action: ConnectAction | null;
      readonly flow: AuthFlow | null;
      readonly kind: "auth";
    };

/** The method, authentication and success views for one server-declared provider. */
export function ProviderJourneyViews({
  capabilities,
  connectionId,
  provider,
  snapshot,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly provider: ForgeProvider;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  const tray = useTray();
  const interactionKey = providerInteractionKey(connectionId, provider.pluginId);
  const interaction = useSelector(() =>
    providerInteractionState(onboardingModel[interactionKey]?.get()),
  );
  const recoveredFlow = activeFlow(provider, snapshot.flows);
  const [journey, setJourney] = useState<JourneyState>(() =>
    recoveredFlow === null ? { kind: "idle" } : { action: null, flow: recoveredFlow, kind: "auth" },
  );
  const flow = journeyFlow(journey, recoveredFlow);
  const authViewId =
    journey.kind === "auth" && journey.action !== null
      ? providerAuthActionView(provider.pluginId, connectActionKey(journey.action))
      : providerAuthView(provider.pluginId);
  const complete = useEvent((): void => {
    tray.setView(providerSuccessView(provider.pluginId));
  });
  const connectedAccount = connectedProviderAccount(snapshot.accounts, provider);
  const authenticationActive = tray.view === authViewId;
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
    if (authenticationActive && connectedAccount !== null) {
      complete();
    }
  }, [authenticationActive, complete, connectedAccount, flow, interactionKey]);

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
            setJourney({ action, flow: result.flow, kind: "auth" });
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
    setJourney({ action, flow: null, kind: "auth" });
    tray.setView(providerAuthActionView(provider.pluginId, connectActionKey(action)));
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
        tray.goBack();
      },
      operation: async () => capabilities.cancelAuth(connectionId, flow.flowId),
      pending: "cancelling",
    });
  });
  const retry = useEvent((method: AuthMethod, login: string | null): void => {
    const action = actionForMethod(method, login);
    if (action !== null) {
      setJourney({ action, flow: null, kind: "auth" });
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
  const connectAnother = useEvent((): void => {
    setJourney({ kind: "idle" });
    tray.open(PROVIDERS_VIEW);
  });
  const handlers: ConnectHandlers = {
    busy: interaction.pending !== null || provider.defaultHost === null,
    checking: interaction.pending === "checking",
    onAction,
    onCheckAgain: checkAgain,
    startingKey:
      interaction.pending === "starting" && journey.kind === "auth" && journey.action !== null
        ? connectActionKey(journey.action)
        : null,
  };
  return (
    <>
      <ProviderMethodsTrayView
        accounts={snapshot.accounts}
        error={interaction.error}
        handlers={handlers}
        provider={provider}
      />
      <ProviderAuthenticationTrayView
        cancelling={interaction.pending === "cancelling"}
        checking={interaction.pending === "checking"}
        error={interaction.error}
        flow={flow}
        journey={journey}
        key={authViewId}
        onCancel={cancel}
        onCheckAgain={checkAgain}
        onRetry={retry}
        onSubmitToken={submitToken}
        pending={interaction.pending === "starting"}
        provider={provider}
        viewId={authViewId}
      />
      <ProviderSuccessTrayView
        onConnectAnother={connectAnother}
        onDone={tray.close}
        provider={provider}
      />
    </>
  );
}

function ProviderMethodsTrayView({
  accounts,
  error,
  handlers,
  provider,
}: {
  readonly accounts: readonly AccountState[];
  readonly error: string | null;
  readonly handlers: ConnectHandlers;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  return (
    <Tray.View id={providerMethodsView(provider.pluginId)}>
      <ProviderTrayHeader back step={METHOD_STEP} title={`Connect ${provider.forgeName}`} />
      <Tray.Body>
        <ProviderMethodsBody
          accounts={accounts}
          error={error}
          handlers={handlers}
          provider={provider}
        />
      </Tray.Body>
    </Tray.View>
  );
}

function ProviderMethodsBody({
  accounts,
  error,
  handlers,
  provider,
}: {
  readonly accounts: readonly AccountState[];
  readonly error: string | null;
  readonly handlers: ConnectHandlers;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  return (
    <View style={styles.providerPanel} testID={`forge-provider-card-${provider.pluginId}`}>
      <ProductText style={styles.trayIntro}>{providerExplanation(provider)}</ProductText>
      <TrayConnectMethods
        handlers={handlers}
        plan={methodsPlan(provider, linkedProviderLogins(accounts, provider))}
        provider={provider}
      />
      <InteractionError error={error} />
      <TrayTrust />
    </View>
  );
}

function ProviderAuthenticationTrayView({
  cancelling,
  checking,
  error,
  flow,
  journey,
  onCancel,
  onCheckAgain,
  onRetry,
  onSubmitToken,
  pending,
  provider,
  viewId,
}: {
  readonly cancelling: boolean;
  readonly checking: boolean;
  readonly error: string | null;
  readonly flow: AuthFlow | null;
  readonly journey: JourneyState;
  readonly onCancel: () => void;
  readonly onCheckAgain: () => void;
  readonly onRetry: (method: AuthMethod, login: string | null) => void;
  readonly onSubmitToken: (token: string) => Promise<void>;
  readonly pending: boolean;
  readonly provider: ForgeProvider;
  readonly viewId: string;
}): React.JSX.Element {
  return (
    <Tray.View id={viewId}>
      <ProviderTrayHeader
        back
        step={AUTHENTICATION_STEP}
        title={authenticationTitle(provider, journey, flow)}
      />
      <Tray.Body>
        <AuthenticationPanel
          cancelling={cancelling}
          checking={checking}
          error={error}
          flow={flow}
          journey={journey}
          onCancel={onCancel}
          onCheckAgain={onCheckAgain}
          onRetry={onRetry}
          onSubmitToken={onSubmitToken}
          pending={pending}
          provider={provider}
        />
      </Tray.Body>
    </Tray.View>
  );
}

function ProviderSuccessTrayView({
  onConnectAnother,
  onDone,
  provider,
}: {
  readonly onConnectAnother: () => void;
  readonly onDone: () => void;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  return (
    <Tray.View id={providerSuccessView(provider.pluginId)}>
      <ProviderTrayHeader step={SUCCESS_STEP} title="Connected" />
      <Tray.Body>
        <ProviderSuccessPanel onConnectAnother={onConnectAnother} onDone={onDone} />
      </Tray.Body>
    </Tray.View>
  );
}

function AuthenticationPanel({
  cancelling,
  checking,
  error,
  flow,
  journey,
  onCancel,
  onCheckAgain,
  onRetry,
  onSubmitToken,
  pending,
  provider,
}: {
  readonly cancelling: boolean;
  readonly checking: boolean;
  readonly error: string | null;
  readonly flow: AuthFlow | null;
  readonly journey: JourneyState;
  readonly onCancel: () => void;
  readonly onCheckAgain: () => void;
  readonly onRetry: (method: AuthMethod, login: string | null) => void;
  readonly onSubmitToken: (token: string) => Promise<void>;
  readonly pending: boolean;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  if (flow !== null) {
    return (
      <FlowPanel
        busy={pending || cancelling}
        cancelling={cancelling}
        flow={flow}
        methods={accountMethods(provider)}
        onCancel={onCancel}
        onStart={onRetry}
      />
    );
  }
  return (
    <AuthenticationActionPanel
      action={journey.kind === "auth" ? journey.action : null}
      checking={checking}
      error={error}
      onCheckAgain={onCheckAgain}
      onSubmitToken={onSubmitToken}
      pending={pending}
      provider={provider}
    />
  );
}

function AuthenticationActionPanel({
  action,
  checking,
  error,
  onCheckAgain,
  onSubmitToken,
  pending,
  provider,
}: {
  readonly action: ConnectAction | null;
  readonly checking: boolean;
  readonly error: string | null;
  readonly onCheckAgain: () => void;
  readonly onSubmitToken: (token: string) => Promise<void>;
  readonly pending: boolean;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  if (action === null) {
    return <ProductText style={styles.body}>Choose a connection method to continue.</ProductText>;
  }
  if (action.kind === "pasteToken" && provider.defaultHost !== null) {
    return (
      <TrayTokenPanel host={provider.defaultHost} method={action.method} onSubmit={onSubmitToken} />
    );
  }
  if (action.kind === "instructions") {
    return (
      <InstructionsPanel checking={checking} method={action.method} onCheckAgain={onCheckAgain} />
    );
  }
  return (
    <View style={styles.authPending}>
      <AppText shimmering={pending} style={styles.authPendingTitle}>
        {action.kind === "link"
          ? `Connecting @${action.login}`
          : `Starting ${provider.forgeName} sign-in`}
      </AppText>
      <InteractionError error={error} />
    </View>
  );
}

function ProviderSuccessPanel({
  onConnectAnother,
  onDone,
}: {
  readonly onConnectAnother: () => void;
  readonly onDone: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.successPanel} testID="forge-provider-success">
      <View style={styles.successIcon}>
        <Ionicons color={colors.green} name="checkmark" size={iconSize.navigation} />
      </View>
      <ProductText style={styles.body}>
        Pull requests from this provider are ready in your review inbox.
      </ProductText>
      <View style={styles.successActions}>
        <AppButton onPress={onDone} size="sm" variant="primary">
          View pull requests
        </AppButton>
        <AppButton onPress={onConnectAnother} size="sm" variant="ghost">
          Connect another provider
        </AppButton>
      </View>
    </View>
  );
}

function authenticationTitle(
  provider: ForgeProvider,
  journey: JourneyState,
  flow: AuthFlow | null,
): string {
  if (flow !== null) {
    return `Sign in to ${provider.forgeName}`;
  }
  if (journey.kind !== "auth" || journey.action === null) {
    return `Connect ${provider.forgeName}`;
  }
  return journey.action.kind === "pasteToken"
    ? journey.action.method.label
    : `Connect ${provider.forgeName}`;
}

function connectedProviderAccount(
  accounts: readonly AccountState[],
  provider: ForgeProvider,
): AccountState | null {
  return (
    accounts.find(
      (account) =>
        account.pluginId === provider.pluginId &&
        account.host === provider.defaultHost &&
        account.state === "connected",
    ) ?? null
  );
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

function linkedProviderLogins(
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

function actionForMethod(method: AuthMethod, login: string | null): ConnectAction | null {
  if (method.kind === "linkExisting") {
    return login === null ? null : { kind: "link", login, method };
  }
  return { kind: method.kind, method };
}

function InteractionError({ error }: { readonly error: string | null }): React.JSX.Element | null {
  return error === null ? null : (
    <ProductText accessibilityLiveRegion="polite" style={styles.error}>
      {error}
    </ProductText>
  );
}
