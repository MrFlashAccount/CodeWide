import { useState, type ReactNode } from "react";

import type { ForgeAccountsSnapshot, ForgeProvider } from "../../../data/forgeContract";
import { useEvent } from "../../../react/useEvent";
import { appTrayPalette, appTrayStyles } from "../../../ui/appTrayAppearance";
import { Tray, useTray, type ITrayMotion } from "../../../vendor/reacticx/tray";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { onboardingStyles as styles } from "./onboarding.styles";
import { ProviderChoices } from "./ProviderChoices";
import { ProviderJourneyViews } from "./ProviderJourneyViews";
import { ProviderTrayHeader, TrayTrust } from "./ProviderTrayChrome";
import { PROVIDERS_VIEW, PROVIDER_STEP, providerMethodsView } from "./providerTrayNavigation";

const PROVIDER_LIST_MAX_HEIGHT = 440;
const REACTICX_DEMO_PAGE_TRAVEL_DP = 90;
// Reacticx's multi-page demo slides pages at full size. Keep the opening full size as well.
const ACCOUNT_TRAY_MOTION: Partial<ITrayMotion> = {
  startScale: 1,
  viewAxis: "x",
  viewSlide: REACTICX_DEMO_PAGE_TRAVEL_DP,
  viewStartScale: 1,
};
/** Connect CTA and its server-driven provider/auth view stack. */
export function ProviderConnectTray({
  capabilities,
  children,
  connectionId,
  onOpenChange,
  snapshot,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly children: ReactNode;
  readonly connectionId: string;
  readonly onOpenChange?: (open: boolean) => void;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  const handleOpenChange = useEvent(onOpenChange);
  return (
    <Tray
      defaultView={PROVIDERS_VIEW}
      motion={ACCOUNT_TRAY_MOTION}
      onOpenChange={handleOpenChange}
      palette={appTrayPalette}
      theme="dark"
    >
      {children}
      <Tray.Content backBehavior="previousView" style={appTrayStyles.surface}>
        <ProviderPages
          capabilities={capabilities}
          connectionId={connectionId}
          snapshot={snapshot}
        />
      </Tray.Content>
    </Tray>
  );
}

function ProviderPages({
  capabilities,
  connectionId,
  snapshot,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  const tray = useTray();
  const [selection, setSelection] = useState<{
    readonly id: string;
    readonly visit: number;
  } | null>(null);
  const selected = snapshot.providers.find((provider) => provider.pluginId === selection?.id);
  const select = useEvent((provider: ForgeProvider) => {
    // Each visit starts with the Companion's current auth flow, including a resumed sign-in.
    setSelection((last) => ({ id: provider.pluginId, visit: (last?.visit ?? 0) + 1 }));
    tray.setView(providerMethodsView(provider.pluginId));
  });
  return (
    <>
      <ProviderListView onSelect={select} providers={snapshot.providers} />
      {selected === undefined ? null : (
        <ProviderJourneyViews
          capabilities={capabilities}
          connectionId={connectionId}
          key={selection?.visit}
          provider={selected}
          snapshot={snapshot}
        />
      )}
    </>
  );
}

function ProviderListView({
  onSelect,
  providers,
}: {
  readonly onSelect: (provider: ForgeProvider) => void;
  readonly providers: readonly ForgeProvider[];
}): React.JSX.Element {
  return (
    <Tray.View id={PROVIDERS_VIEW}>
      <ProviderTrayHeader step={PROVIDER_STEP} title="Connect a provider" />
      <Tray.ScrollView
        contentContainerStyle={[styles.providerList, styles.stepContent]}
        maxHeight={PROVIDER_LIST_MAX_HEIGHT}
      >
        <ProviderChoices onSelect={onSelect} providers={providers} />
        <TrayTrust />
      </Tray.ScrollView>
    </Tray.View>
  );
}
