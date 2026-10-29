import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";

import type { ForgeAccountsSnapshot, ForgeProvider } from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, iconSize } from "../../../theme";
import { AppSheet } from "../../../ui/AppSheet";
import { AppText } from "../../../ui/AppText";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { methodsPlan } from "./cardPlan";
import { onboardingStyles } from "./onboarding.styles";
import { InteractionError, ProviderAuthenticationPanel } from "./ProviderAuthenticationPanel";
import { providerSignInStyles as styles } from "./ProviderSignInSheet.styles";
import { TrayTrust } from "./ProviderTrayChrome";
import { accountMethods, activeFlow, providerExplanation } from "./providerPresentation";
import { TrayConnectMethods } from "./TrayConnectMethods";
import {
  authenticationTitle,
  linkedProviderLogins,
  useProviderJourney,
  type ProviderJourney,
} from "./useProviderJourney";

type SignInStep = "authentication" | "methods";

/**
 * Add account for one provider in its own sheet: the plugin's methods, then the
 * chosen authentication step (link a host login, host sign-in code, token or
 * host steps). A live host-login flow is Companion-owned, so reopening the
 * sheet resumes it; a newly connected account closes the sheet.
 */
export function ProviderSignInSheet({
  capabilities,
  connectionId,
  onDismiss,
  provider,
  snapshot,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly onDismiss: () => void;
  readonly provider: ForgeProvider;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  const [step, setStep] = useState<SignInStep>(() =>
    activeFlow(provider, snapshot.flows) === null ? "methods" : "authentication",
  );
  const journey = useProviderJourney({
    capabilities,
    connectionId,
    navigation: {
      isAuthenticationVisible: () => step === "authentication",
      onCancelled: () => {
        setStep("methods");
      },
      onComplete: onDismiss,
      onShowAuthentication: () => {
        setStep("authentication");
      },
    },
    provider,
    snapshot,
  });
  const back = useEvent((): void => {
    journey.reset();
    setStep("methods");
  });
  return (
    <AppSheet
      contentProps={{ dismissLabel: `Close ${provider.forgeName} sign-in` }}
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          onDismiss();
        }
      }}
    >
      <View style={styles.content} testID={`forge-sign-in-sheet-${provider.pluginId}`}>
        <SignInHeader
          onBack={back}
          provider={provider}
          title={
            step === "methods"
              ? `Add ${provider.forgeName} account`
              : authenticationTitle(provider, journey)
          }
          withBack={step === "authentication"}
        />
        {step === "methods" ? (
          <SignInMethods journey={journey} provider={provider} snapshot={snapshot} />
        ) : (
          <ProviderAuthenticationPanel journey={journey} provider={provider} />
        )}
        <TrayTrust />
      </View>
    </AppSheet>
  );
}

function SignInHeader({
  onBack,
  provider,
  title,
  withBack,
}: {
  readonly onBack: () => void;
  readonly provider: ForgeProvider;
  readonly title: string;
  readonly withBack: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.header}>
      {withBack ? (
        <Pressable
          accessibilityLabel="Back to sign-in methods"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.back}
        >
          <Ionicons color={colors.text} name="chevron-back" size={iconSize.action} />
        </Pressable>
      ) : (
        <View style={styles.mark}>
          <ForgeIcon color={colors.text} icon={provider.icon} size={iconSize.navigation} />
        </View>
      )}
      <AppText accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {title}
      </AppText>
    </View>
  );
}

function SignInMethods({
  journey,
  provider,
  snapshot,
}: {
  readonly journey: ProviderJourney;
  readonly provider: ForgeProvider;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  return (
    <View style={onboardingStyles.providerPanel}>
      <ProductText style={onboardingStyles.trayIntro}>{providerExplanation(provider)}</ProductText>
      {accountMethods(provider).length === 0 ? (
        <ProductText style={onboardingStyles.body}>
          The Companion reports no sign-in methods for this provider right now.
        </ProductText>
      ) : (
        <TrayConnectMethods
          handlers={journey.handlers}
          plan={methodsPlan(provider, linkedProviderLogins(snapshot.accounts, provider))}
          provider={provider}
        />
      )}
      <InteractionError error={journey.error} />
    </View>
  );
}
