import { useState } from "react";

import type {
  AccountState,
  DisconnectMode,
  ForgeAccountsSnapshot,
  ForgeProvider,
} from "../../../data/forgeContract";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import { AppSheet, AppSheetScrollView } from "../../../ui/AppSheet";
import { AppText } from "../../../ui/AppText";
import { ProviderSignInSheet } from "../onboarding/ProviderSignInSheet";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import type { AccountMenuAction } from "./AccountRow";
import { accountsSheetStyles as styles } from "./AccountsSheet.styles";
import { ProviderSection } from "./ProviderSection";

/**
 * Accounts of one connection, grouped by provider like the account pool: each
 * account has its catalog switch and an overflow menu (Check again, removal);
 * each provider has one Add account row that opens its sign-in sheet.
 * `logoutHost` affects every tool using that host login, so it runs only after
 * a destructive confirmation.
 */
export function AccountsSheet({
  capabilities,
  connectionId,
  onDismiss,
  snapshot,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly onDismiss: () => void;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  const dialog = useAppDialog();
  const [busy, setBusy] = useState(false);
  const [signInPluginId, setSignInPluginId] = useState<string | null>(null);
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
    if (mode !== "logoutHost") {
      run(async () =>
        capabilities.disconnect(connectionId, {
          account: account.account,
          confirmation: "none",
          mode,
        }),
      );
      return;
    }
    dialog.alert(
      `Log out @${account.login} on ${account.host}?`,
      "Every tool on the companion host that uses this login is signed out too.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            run(async () =>
              capabilities.disconnect(connectionId, {
                account: account.account,
                confirmation: "destructive",
                mode,
              }),
            );
          },
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
  const addAccount = useEvent((provider: ForgeProvider): void => {
    setSignInPluginId(provider.pluginId);
  });
  const signInProvider =
    snapshot.providers.find((provider) => provider.pluginId === signInPluginId) ?? null;
  return (
    <>
      <AppSheet
        contentProps={{ dismissLabel: "Close accounts", enablePanDownToClose: !busy }}
        isOpen
        onOpenChange={(next) => {
          if (!next) {
            onDismiss();
          }
        }}
      >
        <ProviderSections
          busy={busy}
          capabilities={capabilities}
          connectionId={connectionId}
          onAddAccount={addAccount}
          onMenuAction={menuAction}
          snapshot={snapshot}
        />
      </AppSheet>
      {signInProvider === null ? null : (
        <ProviderSignInSheet
          capabilities={capabilities}
          connectionId={connectionId}
          key={signInProvider.pluginId}
          onDismiss={() => {
            setSignInPluginId(null);
          }}
          provider={signInProvider}
          snapshot={snapshot}
        />
      )}
    </>
  );
}

function ProviderSections({
  busy,
  capabilities,
  connectionId,
  onAddAccount,
  onMenuAction,
  snapshot,
}: {
  readonly busy: boolean;
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly onAddAccount: (provider: ForgeProvider) => void;
  readonly onMenuAction: (account: AccountState, action: AccountMenuAction) => void;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  return (
    <AppSheetScrollView contentContainerStyle={styles.content} testID="forge-accounts-sheet">
      <AppText accessibilityRole="header" style={styles.title}>
        Pull request accounts
      </AppText>
      {snapshot.providers.map((provider) => (
        <ProviderSection
          busy={busy}
          capabilities={capabilities}
          connectionId={connectionId}
          key={provider.pluginId}
          onAddAccount={onAddAccount}
          onMenuAction={onMenuAction}
          provider={provider}
          snapshot={snapshot}
        />
      ))}
    </AppSheetScrollView>
  );
}
