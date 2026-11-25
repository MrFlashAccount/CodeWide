import { useState } from "react";
import { View } from "react-native";

import type { AccountState, ForgeProvider } from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import type { ActionMenuItem } from "../../../ui/ActionMenu";
import { AppListRow } from "../../../ui/AppListRow";
import { AppSwitch } from "../../../ui/AppSwitch";
import { OverflowMenu } from "../../../ui/OverflowMenu";
import { ChecksCredentialStep } from "../onboarding/ChecksCredentialStep";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { accountDescription, DISCONNECT_LABELS, disconnectModes } from "./accountPresentation";
import { accountsSheetStyles as styles } from "./AccountsSheet.styles";

const CHECK_AGAIN = "checkAgain";

/** One account action chosen from the row's overflow menu. */
export type AccountMenuAction =
  | { readonly kind: "checkAgain" }
  | { readonly kind: "disconnect"; readonly mode: ReturnType<typeof disconnectModes>[number] };

/** Live detail-page contents for the account selected in settings. */
export function AccountDetails({
  account,
  busy,
  capabilities,
  connectionId,
  onMenuAction,
  provider,
  serverName,
}: {
  readonly account: AccountState;
  /** Another account operation of the sheet is running. */
  readonly busy: boolean;
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly onMenuAction: (account: AccountState, action: AccountMenuAction) => void;
  readonly provider: ForgeProvider | undefined;
  readonly serverName: string;
}): React.JSX.Element {
  const forgeName = provider?.forgeName ?? account.pluginId;
  const catalog = useAccountCatalogSwitch({ account, capabilities, connectionId });
  const modes = disconnectModes(account, provider);
  const actions: ActionMenuItem[] = [
    ...(account.state === "connected"
      ? []
      : [{ icon: "refresh-outline" as const, id: CHECK_AGAIN, label: "Check again" }]),
    ...modes.map((mode) => ({
      destructive: true,
      icon: mode === "logoutHost" ? ("log-out-outline" as const) : ("trash-outline" as const),
      id: mode,
      label: DISCONNECT_LABELS[mode],
    })),
  ];
  const selectAction = useEvent((id: string): void => {
    if (id === CHECK_AGAIN) {
      onMenuAction(account, { kind: "checkAgain" });
      return;
    }
    const mode = modes.find((candidate) => candidate === id);
    if (mode !== undefined) {
      onMenuAction(account, { kind: "disconnect", mode });
    }
  });
  return (
    <View style={styles.content}>
      <ProductText style={styles.identity}>{`${forgeName} · ${serverName}`}</ProductText>
      <AppListRow
        description={accountDescription(account)}
        title={account.host}
        trailing={
          <OverflowMenu
            accessibilityLabel={`Actions for @${account.login}`}
            actions={actions}
            onSelect={selectAction}
            tone="dim"
          />
        }
      />
      {catalog.value === null ? null : (
        <AppListRow
          shimmering={catalog.pending}
          title="Show in pull request list"
          trailing={
            <AppSwitch
              accessibilityLabel={`Show pull requests from @${account.login}`}
              disabled={busy || catalog.pending}
              onValueChange={catalog.toggle}
              value={catalog.value}
            />
          }
        />
      )}
      <ChecksCredentialStep
        capabilities={capabilities}
        connectionId={connectionId}
        provider={provider}
      />
      {catalog.error === null ? null : (
        <ProductText accessibilityLiveRegion="polite" style={styles.rowError}>
          {catalog.error}
        </ProductText>
      )}
    </View>
  );
}

type CatalogSwitch = {
  readonly error: string | null;
  readonly pending: boolean;
  readonly toggle: (enabled: boolean) => void;
  /** Requested value while pending, else the Companion's; `null` when it has no switch. */
  readonly value: boolean | null;
};

/** Pending and failure of one account's catalog switch; the value itself stays Companion-owned. */
function useAccountCatalogSwitch({
  account,
  capabilities,
  connectionId,
}: {
  readonly account: AccountState;
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
}): CatalogSwitch {
  const [requested, setRequested] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const toggle = useEvent((enabled: boolean): void => {
    if (requested !== null) {
      return;
    }
    setRequested(enabled);
    setFailure(null);
    capabilities.setAccountEnabled(connectionId, account.account, enabled).then(
      () => {
        setRequested(null);
      },
      (error: unknown) => {
        setRequested(null);
        setFailure(error instanceof Error ? error.message : "Could not update the account");
      },
    );
  });
  return {
    error: failure,
    pending: requested !== null,
    toggle,
    value: requested ?? account.catalogEnabled,
  };
}
