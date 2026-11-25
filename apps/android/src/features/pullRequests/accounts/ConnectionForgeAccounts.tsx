import { useState } from "react";
import { View } from "react-native";

import type {
  AccountState,
  DisconnectMode,
  ForgeAccountsSnapshot,
} from "../../../data/forgeContract";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import { AppListRow } from "../../../ui/AppListRow";
import { listRowPosition } from "../../../ui/AppListRow.types";
import { iconSize } from "../../../theme";
import { ProviderSettingsPages } from "../onboarding/ProviderSettingsPages";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { AccountRow } from "./AccountRow";
import { AccountDetails, type AccountMenuAction } from "./AccountDetails";
import type { ForgeAccountSettingsPage } from "../forgeAccountSettingsPage";
import { AppText } from "../../../ui/AppText";

/** One account list and one provider-selection entry point for the selected server. */
export function ConnectionForgeAccounts({
  capabilities,
  connectionId,
  page,
  serverName,
  snapshot,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly page: ForgeAccountSettingsPage;
  readonly serverName: string;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  const dialog = useAppDialog();
  const [busy, setBusy] = useState(false);
  const run = useEvent((operation: () => Promise<unknown>): void => {
    setBusy(true);
    operation()
      .catch((error: unknown) => {
        dialog.error("Could not update the account", error);
      })
      .finally(() => {
        setBusy(false);
      });
  });
  const disconnect = useEvent((account: AccountState, mode: DisconnectMode): void => {
    if (page.kind !== "account") {
      return;
    }
    const goBack = page.back;
    const remove = () => {
      run(async () => {
        await capabilities.disconnect(connectionId, {
          account: account.account,
          confirmation: mode === "logoutHost" ? "destructive" : "none",
          mode,
        });
        goBack();
      });
    };
    if (mode !== "logoutHost") {
      remove();
      return;
    }
    dialog.alert(
      `Log out @${account.login} on ${account.host}?`,
      "Every tool on the companion host that uses this login is signed out too.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: remove,
          style: "destructive",
          text: "Log out",
        },
      ],
    );
  });
  const menuAction = useEvent((account: AccountState, action: AccountMenuAction): void => {
    if (action.kind === "checkAgain") {
      run(async () => capabilities.checkAgain(connectionId));
      return;
    }
    disconnect(account, action.mode);
  });
  const addAccount = useEvent(() => {
    if (page.kind === "list") {
      page.add(connectionId);
    }
  });
  if (page.kind === "connect") {
    return (
      <ProviderSettingsPages
        capabilities={capabilities}
        connectionId={connectionId}
        onBack={page.back}
        snapshot={snapshot}
      />
    );
  }
  if (page.kind === "account") {
    const account = snapshot.accounts.find(
      (candidate) => candidate.account === page.selection.account,
    );
    if (account === undefined) {
      return <AppText>Account no longer available</AppText>;
    }
    return (
      <AccountDetails
        account={account}
        busy={busy}
        capabilities={capabilities}
        connectionId={connectionId}
        key={account.account}
        onMenuAction={menuAction}
        provider={snapshot.providers.find((candidate) => candidate.pluginId === account.pluginId)}
        serverName={serverName}
      />
    );
  }
  const count = snapshot.accounts.length;
  const providers = new Map(snapshot.providers.map((provider) => [provider.pluginId, provider]));
  return (
    <View>
      {snapshot.accounts.map((account, index) => (
        <AccountRow
          account={account}
          connectionId={connectionId}
          key={account.account}
          open={page.open}
          position={listRowPosition(index, count + 1)}
          provider={providers.get(account.pluginId)}
        />
      ))}
      <AppListRow
        disabled={busy}
        leadingIcon={{ name: "add", size: iconSize.action }}
        onPress={addAccount}
        position={count === 0 ? "only" : "last"}
        title="Add account"
      />
    </View>
  );
}
