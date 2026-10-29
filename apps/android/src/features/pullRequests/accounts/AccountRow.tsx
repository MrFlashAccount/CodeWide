import { useState } from "react";
import { View } from "react-native";

import type { AccountState, ForgeProvider } from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors } from "../../../theme";
import { ActionMenu, type ActionMenuItem } from "../../../ui/ActionMenu";
import { AppListRow } from "../../../ui/AppListRow";
import { AppListRowMenuTrigger } from "../../../ui/AppListRowMenuTrigger";
import { listRowHeight, type AppListRowProps } from "../../../ui/AppListRow.types";
import { AppSwitch } from "../../../ui/AppSwitch";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { accountDescription, DISCONNECT_LABELS, disconnectModes } from "./accountPresentation";
import { accountsSheetStyles as styles } from "./AccountsSheet.styles";

const STATUS_DOT_SIZE = 10;
const CHECK_AGAIN = "checkAgain";

/** One account action chosen from the row's overflow menu. */
export type AccountMenuAction =
  | { readonly kind: "checkAgain" }
  | { readonly kind: "disconnect"; readonly mode: ReturnType<typeof disconnectModes>[number] };

/**
 * One linked account: login, credential or problem, a switch that includes it
 * in the pull request catalog, and removal behind the overflow menu. While the
 * switch waits for the Companion it shows the requested value and the login
 * shimmers; a refusal restores the authoritative value and shows the reason.
 */
export function AccountRow({
  account,
  busy,
  capabilities,
  connectionId,
  onMenuAction,
  position,
  provider,
}: {
  readonly account: AccountState;
  /** Another account operation of the sheet is running. */
  readonly busy: boolean;
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly onMenuAction: (account: AccountState, action: AccountMenuAction) => void;
  readonly position: NonNullable<AppListRowProps["position"]>;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
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
  const included = catalog.value ?? true;
  return (
    <View testID={`forge-account-${account.login}`}>
      <AppListRow
        accessibilityLabel={`@${account.login}, ${accountDescription(account)}`}
        description={accountDescription(account)}
        fixedHeight={listRowHeight.double}
        position={position}
        shimmering={catalog.pending}
        title={`@${account.login}`}
        titleIndicator={{
          color: included ? statusColor(account) : colors.textDim,
          size: STATUS_DOT_SIZE,
          testID: `forge-account-status-${account.login}`,
        }}
        trailing={
          <AccountRowTrailing
            actions={actions}
            busy={busy}
            catalog={catalog}
            login={account.login}
            onSelect={selectAction}
          />
        }
      />
      {catalog.error === null ? null : (
        <ProductText accessibilityLiveRegion="polite" style={styles.rowError}>
          {catalog.error}
        </ProductText>
      )}
    </View>
  );
}

function AccountRowTrailing({
  actions,
  busy,
  catalog,
  login,
  onSelect,
}: {
  readonly actions: readonly ActionMenuItem[];
  readonly busy: boolean;
  readonly catalog: CatalogSwitch;
  readonly login: string;
  readonly onSelect: (id: string) => void;
}): React.JSX.Element {
  const menuLabel = `Actions for @${login}`;
  return (
    <View style={styles.rowTrailing}>
      {catalog.value === null ? null : (
        <AppSwitch
          accessibilityHint="Includes this account in Pull requests"
          accessibilityLabel={`Show pull requests from @${login}`}
          disabled={busy || catalog.pending}
          onValueChange={catalog.toggle}
          value={catalog.value}
        />
      )}
      <ActionMenu accessibilityLabel={menuLabel} actions={actions} onSelect={onSelect}>
        <AppListRowMenuTrigger accessibilityLabel={menuLabel} />
      </ActionMenu>
    </View>
  );
}

function statusColor(account: AccountState): string {
  if (account.state === "connected") {
    return colors.green;
  }
  return account.state === "expired" ? colors.amber : colors.red;
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
