import { View } from "react-native";

import type { ForgeProvider } from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { AppText } from "../../../ui/AppText";
import type { ConnectAction } from "./cardPlan";
import { FlowPanel } from "./FlowPanel";
import { InstructionsPanel } from "./InstructionsPanel";
import { onboardingStyles as styles } from "./onboarding.styles";
import { accountMethods } from "./providerPresentation";
import { TrayTokenPanel } from "./TrayTokenPanel";
import type { ProviderJourney } from "./useProviderJourney";

/**
 * The authentication step of one provider journey: a live or failed host-login
 * flow, the token entry, host instructions, or the pending link of a login.
 * Shared by the onboarding Tray and the Add account sheet.
 */
export function ProviderAuthenticationPanel({
  journey,
  provider,
}: {
  readonly journey: ProviderJourney;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  if (journey.flow !== null) {
    return (
      <FlowPanel
        busy={journey.starting || journey.cancelling}
        cancelling={journey.cancelling}
        flow={journey.flow}
        methods={accountMethods(provider)}
        onCancel={journey.cancel}
        onStart={journey.retry}
      />
    );
  }
  return (
    <AuthenticationActionPanel
      action={journey.journey.kind === "auth" ? journey.journey.action : null}
      journey={journey}
      provider={provider}
    />
  );
}

function AuthenticationActionPanel({
  action,
  journey,
  provider,
}: {
  readonly action: ConnectAction | null;
  readonly journey: ProviderJourney;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  if (action === null) {
    return <ProductText style={styles.body}>Choose a connection method to continue.</ProductText>;
  }
  if (action.kind === "pasteToken" && provider.defaultHost !== null) {
    return (
      <TrayTokenPanel
        host={provider.defaultHost}
        method={action.method}
        onSubmit={journey.submitToken}
      />
    );
  }
  if (action.kind === "instructions") {
    return (
      <InstructionsPanel
        checking={journey.checking}
        method={action.method}
        onCheckAgain={journey.checkAgain}
      />
    );
  }
  return (
    <View style={styles.authPending}>
      <AppText shimmering={journey.starting} style={styles.authPendingTitle}>
        {action.kind === "link"
          ? `Connecting @${action.login}`
          : `Starting ${provider.forgeName} sign-in`}
      </AppText>
      <InteractionError error={journey.error} />
    </View>
  );
}

/** The Companion's short reason for the last failed connect operation. */
export function InteractionError({
  error,
}: {
  readonly error: string | null;
}): React.JSX.Element | null {
  return error === null ? null : (
    <ProductText accessibilityLiveRegion="polite" style={styles.error}>
      {error}
    </ProductText>
  );
}
