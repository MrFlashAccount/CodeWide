import { useState } from "react";

import type {
  AccountState,
  DisconnectMode,
  ForgeAccountsSnapshot,
  ForgeProvider,
} from "../../../data/forgeContract";
import { ProductText } from "../../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import { AppSheet, AppSheetScrollView } from "../../../ui/AppSheet";
import { onboardingStyles as styles } from "../onboarding/onboarding.styles";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { AccountRow } from "./AccountRow";
import { ProviderSection } from "./ProviderSection";

/**
 * Accounts and providers of one connection: linked accounts with their
 * credential source and scopes, disconnect modes, the optional checks
 * credential, provider enable switches, and a connect card per provider.
 * `logoutHost` affects every tool using that host login, so it runs only
 * after a destructive confirmation.
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
  const [checking, setChecking] = useState<string | null>(null);
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
  const checkAgain = useEvent((account: AccountState): void => {
    setChecking(account.account);
    run(async () =>
      capabilities.checkAgain(connectionId).finally(() => {
        setChecking(null);
      }),
    );
  });
  const setEnabled = useEvent((provider: ForgeProvider, enabled: boolean): void => {
    run(async () => capabilities.setProviderEnabled(connectionId, provider.pluginId, enabled));
  });
  return (
    <AppSheet
      contentProps={{ dismissLabel: "Close accounts", enablePanDownToClose: !busy }}
      isOpen
      onOpenChange={(next) => {
        if (!next) {
          onDismiss();
        }
      }}
    >
      <AppSheetScrollView contentContainerStyle={styles.sheetList} testID="forge-accounts-sheet">
        <ProductText accessibilityRole="header" style={styles.title}>
          Forge accounts
        </ProductText>
        {snapshot.accounts.map((account) => (
          <AccountRow
            account={account}
            busy={busy}
            checking={checking === account.account}
            key={account.account}
            onCheckAgain={checkAgain}
            onDisconnect={disconnect}
            provider={snapshot.providers.find((provider) => provider.pluginId === account.pluginId)}
          />
        ))}
        {snapshot.providers.map((provider) => (
          <ProviderSection
            busy={busy}
            capabilities={capabilities}
            connectionId={connectionId}
            key={provider.pluginId}
            onSetEnabled={setEnabled}
            provider={provider}
            snapshot={snapshot}
          />
        ))}
      </AppSheetScrollView>
    </AppSheet>
  );
}
