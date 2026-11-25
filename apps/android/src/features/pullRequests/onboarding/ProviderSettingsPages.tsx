import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { View } from "react-native";

import type { ForgeAccountsSnapshot, ForgeProvider } from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { SheetNavigationPage } from "../../../ui/SheetNavigationPage";
import { SheetPageTransition, useSheetBackHandler } from "../../../ui/sheetNavigation";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { connectActionKey } from "./cardPlan";
import { onboardingStyles as styles } from "./onboarding.styles";
import { ProviderAuthenticationPanel } from "./ProviderAuthenticationPanel";
import { ProviderChoices } from "./ProviderChoices";
import { ProviderMethodsContent } from "./ProviderMethodsContent";
import { activeFlow } from "./providerPresentation";
import { TrayTrust } from "./ProviderTrayChrome";
import { authenticationTitle, useProviderJourney } from "./useProviderJourney";

type Step =
  | { readonly kind: "providers" }
  | { readonly kind: "methods"; readonly providerId: string }
  | { readonly actionKey: string | null; readonly kind: "auth"; readonly providerId: string };

interface SettingsConnectProps {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly onBack: () => void;
  readonly snapshot: ForgeAccountsSnapshot;
}

/** Runs the provider journey within the open settings window. */
export function ProviderSettingsPages(props: SettingsConnectProps): React.JSX.Element {
  const [navigation, setNavigation] = useState<{
    readonly direction: "back" | "forward" | null;
    readonly step: Step;
  }>({ direction: null, step: { kind: "providers" } });
  const { direction, step } = navigation;
  const provider =
    step.kind === "providers"
      ? undefined
      : props.snapshot.providers.find((item) => item.pluginId === step.providerId);
  const select = useEvent((item: ForgeProvider) => {
    const providerId = item.pluginId;
    const next: Step =
      activeFlow(item, props.snapshot.flows) === null
        ? { kind: "methods", providerId }
        : { actionKey: null, kind: "auth", providerId };
    setNavigation({ direction: "forward", step: next });
  });
  const back = useEvent(() => {
    if (step.kind === "providers") {
      props.onBack();
    } else {
      setNavigation({
        direction: "back",
        step:
          step.kind === "auth" && provider !== undefined
            ? { kind: "methods", providerId: step.providerId }
            : { kind: "providers" },
      });
    }
  });
  useSheetBackHandler(step.kind !== "providers", back);
  const authenticate = useEvent((actionKey: string) => {
    if (step.kind === "methods") {
      setNavigation({
        direction: "forward",
        step: { actionKey, kind: "auth", providerId: step.providerId },
      });
    }
  });

  function renderPage(title: string, children: ReactNode): React.JSX.Element {
    const position =
      step.kind === "providers" ? "1 of 3" : step.kind === "methods" ? "2 of 3" : "3 of 3";
    return (
      <SheetPageTransition direction={direction} routeKey={step.kind}>
        <SheetNavigationPage
          action={<ProductText style={styles.trayStep}>{position}</ProductText>}
          back={{
            label: step.kind === "providers" ? "Back to pull requests" : "Back",
            onPress: back,
          }}
          title={title}
        >
          <View style={styles.stepContent}>{children}</View>
        </SheetNavigationPage>
      </SheetPageTransition>
    );
  }
  if (step.kind === "providers") {
    return renderPage(
      "Connect a provider",
      <>
        <ProviderChoices onSelect={select} providers={props.snapshot.providers} />
        <TrayTrust />
      </>,
    );
  }
  if (provider === undefined) {
    return renderPage("Add account", <ProductText>Provider unavailable</ProductText>);
  }
  return (
    <SelectedProviderPage
      capabilities={props.capabilities}
      connectionId={props.connectionId}
      key={provider.pluginId}
      onAuthenticate={authenticate}
      onBack={props.onBack}
      onStepBack={back}
      provider={provider}
      renderPage={renderPage}
      snapshot={props.snapshot}
      step={step}
    />
  );
}

function SelectedProviderPage({
  capabilities,
  connectionId,
  onAuthenticate,
  onBack,
  onStepBack,
  provider,
  renderPage,
  snapshot,
  step,
}: SettingsConnectProps & {
  readonly onAuthenticate: (actionKey: string) => void;
  readonly onStepBack: () => void;
  readonly provider: ForgeProvider;
  readonly renderPage: (title: string, children: ReactNode) => React.JSX.Element;
  readonly step: Exclude<Step, { kind: "providers" }>;
}): React.JSX.Element {
  // A Companion reply may arrive after Back, dismissal, or a switch to another provider.
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const journey = useProviderJourney({
    capabilities,
    connectionId,
    navigation: {
      isAuthenticationVisible: (key) => step.kind === "auth" && step.actionKey === key,
      onCancelled: () => {
        if (mounted.current && step.kind === "auth") {
          onStepBack();
        }
      },
      onComplete: () => {
        if (mounted.current && step.kind === "auth") {
          onBack();
        }
      },
      onShowAuthentication: (action) => {
        onAuthenticate(connectActionKey(action));
      },
    },
    provider,
    snapshot,
  });
  if (step.kind === "auth") {
    return renderPage(
      authenticationTitle(provider, journey),
      <ProviderAuthenticationPanel journey={journey} provider={provider} />,
    );
  }
  return renderPage(
    `Connect ${provider.forgeName}`,
    <>
      <ProviderMethodsContent
        accounts={snapshot.accounts}
        capabilities={capabilities}
        connectionId={connectionId}
        error={journey.error}
        handlers={journey.handlers}
        provider={provider}
      />
      <TrayTrust />
    </>,
  );
}
