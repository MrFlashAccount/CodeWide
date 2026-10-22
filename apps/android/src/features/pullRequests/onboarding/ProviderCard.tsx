import { useSelector } from "@legendapp/state/react";
import { useState } from "react";
import { View } from "react-native";

import type {
  AccountState,
  AuthFlow,
  AuthMethod,
  ForgeProvider,
} from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { cardPlan, connectActionKey, type CardPlan, type ConnectAction } from "./cardPlan";
import {
  OtherWays,
  PrimaryConnect,
  UnavailableMethods,
  type ConnectHandlers,
} from "./ConnectActions";
import { FlowPanel } from "./FlowPanel";
import { onboardingStyles as styles } from "./onboarding.styles";
import {
  onboardingModel,
  providerInteractionKey,
  providerInteractionState,
} from "./onboardingModel";
import { accountMethods, activeFlow, providerExplanation } from "./providerPresentation";
import { TokenPasteSheet } from "./TokenPasteSheet";
import { useProviderConnect } from "./useProviderConnect";

/**
 * One provider's connect card: icon, what the provider gives, and exactly one
 * primary connect action with every other way in a quiet row. During a
 * host-login flow (awaiting the user or failed) the card shows only that flow,
 * which survives app restarts because it is read from the accounts resource.
 */
export function ProviderCard({
  accounts,
  capabilities,
  connectionId,
  flows,
  provider,
}: {
  /** Accounts already linked on this connection; their logins are not offered again. */
  readonly accounts: readonly AccountState[];
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly flows: readonly AuthFlow[];
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  const interactionKey = providerInteractionKey(connectionId, provider.pluginId);
  const interaction = useSelector(() =>
    providerInteractionState(onboardingModel[interactionKey]?.get()),
  );
  const [tokenMethod, setTokenMethod] = useState<AuthMethod | null>(null);
  const [startedKey, setStartedKey] = useState<string | null>(null);
  const host = provider.defaultHost;
  const flow = activeFlow(provider, flows);
  const connect = useProviderConnect({
    capabilities,
    connectionId,
    flow,
    host,
    interactionKey,
    provider,
  });
  const onAction = useEvent((action: ConnectAction): void => {
    if (action.kind === "pasteToken") {
      setTokenMethod(action.method);
    } else if (action.kind !== "instructions") {
      setStartedKey(connectActionKey(action));
      connect.start(action.method, action.kind === "link" ? action.login : null);
    }
  });
  const handlers: ConnectHandlers = {
    busy: interaction.pending !== null || host === null,
    checking: interaction.pending === "checking",
    onAction,
    onCheckAgain: connect.checkAgain,
    startingKey: interaction.pending === "starting" ? startedKey : null,
  };
  return (
    <View
      accessibilityLabel={`${provider.forgeName} provider`}
      style={styles.card}
      testID={`forge-provider-card-${provider.pluginId}`}
    >
      <ProviderCardHeader provider={provider} />
      <ProductText style={styles.body}>{providerExplanation(provider)}</ProductText>
      <CardBody
        cancelling={interaction.pending === "cancelling"}
        handlers={handlers}
        onCancel={connect.cancel}
        onStart={connect.start}
        plan={cardPlan(provider, flow, linkedLogins(accounts, provider))}
        provider={provider}
      />
      <InteractionError error={interaction.error} />
      {tokenMethod === null || host === null ? null : (
        <TokenPasteSheet
          host={host}
          method={tokenMethod}
          onDismiss={() => {
            setTokenMethod(null);
          }}
          onSubmit={connect.submitToken}
          open
        />
      )}
    </View>
  );
}

/** Logins already linked for the provider's own host on this connection. */
function linkedLogins(
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

function CardBody({
  cancelling,
  handlers,
  onCancel,
  onStart,
  plan,
  provider,
}: {
  readonly cancelling: boolean;
  readonly handlers: ConnectHandlers;
  readonly onCancel: () => void;
  readonly onStart: (method: AuthMethod, login: string | null) => void;
  readonly plan: CardPlan;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  if (plan.kind === "flow") {
    return (
      <FlowPanel
        busy={handlers.busy}
        cancelling={cancelling}
        flow={plan.flow}
        methods={accountMethods(provider)}
        onCancel={onCancel}
        onStart={onStart}
      />
    );
  }
  return (
    <>
      {plan.primary === null ? null : <PrimaryConnect action={plan.primary} handlers={handlers} />}
      <OtherWays actions={plan.others} handlers={handlers} />
      <UnavailableMethods methods={plan.unavailable} />
    </>
  );
}

function ProviderCardHeader({ provider }: { readonly provider: ForgeProvider }): React.JSX.Element {
  return (
    <View style={styles.header}>
      <ForgeIcon
        color={colors.text}
        glyph={provider.icon.glyph}
        iconKey={provider.icon.iconKey}
        size={iconSize.navigation}
      />
      <ProductText accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {provider.forgeName}
      </ProductText>
    </View>
  );
}

function InteractionError({ error }: { readonly error: string | null }): React.JSX.Element | null {
  return error === null ? null : (
    <ProductText accessibilityLiveRegion="polite" style={styles.error}>
      {error}
    </ProductText>
  );
}
