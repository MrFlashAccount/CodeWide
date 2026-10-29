import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import type {
  AccountState,
  ForgeAccountsSnapshot,
  ForgeProvider,
} from "../../../data/forgeContract";
import { colors, iconSize } from "../../../theme";
import { AppListRow } from "../../../ui/AppListRow";
import { listRowHeight, listRowPosition } from "../../../ui/AppListRow.types";
import { ForgeIcon } from "../../../ui/ForgeIcon";
import { SettingsGroupHeader } from "../../../ui/SettingsGroupHeader";
import { ChecksCredentialStep } from "../onboarding/ChecksCredentialStep";
import type { PullRequestsWorkspaceCapabilities } from "../workspaceCapabilities";
import { providerInstalled } from "./accountPresentation";
import { AccountRow, type AccountMenuAction } from "./AccountRow";
import { accountsSheetStyles as styles } from "./AccountsSheet.styles";

const ADD_ROW_COUNT = 1;

/**
 * One provider in the Accounts sheet, shaped like the account pool: its linked
 * accounts, then one Add account row. Only accounts have a switch; a provider
 * is never turned on or off here, and a provider whose plugin is missing or
 * broken says so instead of offering Add account.
 */
export function ProviderSection({
  busy,
  capabilities,
  connectionId,
  onAddAccount,
  onMenuAction,
  provider,
  snapshot,
}: {
  readonly busy: boolean;
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly onAddAccount: (provider: ForgeProvider) => void;
  readonly onMenuAction: (account: AccountState, action: AccountMenuAction) => void;
  readonly provider: ForgeProvider;
  readonly snapshot: ForgeAccountsSnapshot;
}): React.JSX.Element {
  const accounts = snapshot.accounts.filter((account) => account.pluginId === provider.pluginId);
  const count = accounts.length + ADD_ROW_COUNT;
  return (
    <View style={styles.group} testID={`forge-provider-group-${provider.pluginId}`}>
      <SettingsGroupHeader
        leading={<ForgeIcon color={colors.textMuted} icon={provider.icon} size={iconSize.inline} />}
        title={provider.forgeName}
      />
      <View style={styles.groupRows}>
        {accounts.map((account, index) => (
          <AccountRow
            account={account}
            busy={busy}
            capabilities={capabilities}
            connectionId={connectionId}
            key={account.account}
            onMenuAction={onMenuAction}
            position={listRowPosition(index, count)}
            provider={provider}
          />
        ))}
        <ProviderAddRow
          busy={busy}
          onAddAccount={onAddAccount}
          position={listRowPosition(accounts.length, count)}
          provider={provider}
        />
      </View>
      {providerInstalled(provider) ? (
        <ChecksCredentialStep
          capabilities={capabilities}
          connectionId={connectionId}
          provider={provider}
        />
      ) : null}
    </View>
  );
}

function ProviderAddRow({
  busy,
  onAddAccount,
  position,
  provider,
}: {
  readonly busy: boolean;
  readonly onAddAccount: (provider: ForgeProvider) => void;
  readonly position: ReturnType<typeof listRowPosition>;
  readonly provider: ForgeProvider;
}): React.JSX.Element {
  const installation = provider.installation;
  if (installation.state === "missing" || installation.state === "failed") {
    return (
      <AppListRow
        description={installation.reason}
        fixedHeight={listRowHeight.double}
        leadingIcon={{ color: colors.textMuted, name: "alert-circle-outline" }}
        multiline
        position={position}
        testID={`forge-provider-unavailable-${provider.pluginId}`}
        title={installation.state === "missing" ? "Plugin not installed" : "Plugin unavailable"}
      />
    );
  }
  const title = `Add ${provider.forgeName} account`;
  return (
    <AppListRow
      accessibilityLabel={title}
      description={provider.defaultHost ?? "Host unavailable"}
      disabled={busy || provider.defaultHost === null}
      fixedHeight={listRowHeight.double}
      leading={
        <View style={styles.addLeading}>
          <Ionicons color={colors.textMuted} name="add" size={iconSize.action} />
        </View>
      }
      onPress={() => {
        onAddAccount(provider);
      }}
      position={position}
      testID={`forge-add-account-${provider.pluginId}`}
      title={title}
    />
  );
}
