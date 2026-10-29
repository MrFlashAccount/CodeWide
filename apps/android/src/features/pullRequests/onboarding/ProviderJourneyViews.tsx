import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import type {
  AccountState,
  ForgeAccountsSnapshot,
  ForgeProvider,
} from "../../../data/forgeContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { Tray, useTray } from "../../../vendor/reacticx/tray";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { connectActionKey, methodsPlan, type ConnectAction } from "./cardPlan";
import type { ConnectHandlers } from "./ConnectActions";
import { onboardingStyles as styles } from "./onboarding.styles";
import { InteractionError, ProviderAuthenticationPanel } from "./ProviderAuthenticationPanel";
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
import { providerExplanation } from "./providerPresentation";
import { TrayConnectMethods } from "./TrayConnectMethods";
import {
  authenticationTitle,
  linkedProviderLogins,
  useProviderJourney,
  type ProviderJourney,
} from "./useProviderJourney";

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
  const authViewOf = (authKey: string | null): string =>
    authKey === null
      ? providerAuthView(provider.pluginId)
      : providerAuthActionView(provider.pluginId, authKey);
  const journey = useProviderJourney({
    capabilities,
    connectionId,
    navigation: {
      isAuthenticationVisible: (authKey) => tray.view === authViewOf(authKey),
      onCancelled: () => {
        tray.goBack();
      },
      onComplete: () => {
        tray.setView(providerSuccessView(provider.pluginId));
      },
      onShowAuthentication: (action: ConnectAction) => {
        tray.setView(providerAuthActionView(provider.pluginId, connectActionKey(action)));
      },
    },
    provider,
    snapshot,
  });
  const authViewId = authViewOf(journey.authKey);
  const connectAnother = useEvent((): void => {
    journey.reset();
    tray.open(PROVIDERS_VIEW);
  });
  return (
    <>
      <ProviderMethodsTrayView
        accounts={snapshot.accounts}
        error={journey.error}
        handlers={journey.handlers}
        provider={provider}
      />
      <ProviderAuthenticationTrayView
        journey={journey}
        key={authViewId}
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
  journey,
  provider,
  viewId,
}: {
  readonly journey: ProviderJourney;
  readonly provider: ForgeProvider;
  readonly viewId: string;
}): React.JSX.Element {
  return (
    <Tray.View id={viewId}>
      <ProviderTrayHeader
        back
        step={AUTHENTICATION_STEP}
        title={authenticationTitle(provider, journey)}
      />
      <Tray.Body>
        <ProviderAuthenticationPanel journey={journey} provider={provider} />
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
