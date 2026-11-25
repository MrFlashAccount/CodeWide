import { View } from "react-native";

import type { StoredConnection } from "../../data/connection-profile-types";
import { useForgeQuery } from "../../data/forgeQueryResource";
import { remoteValue } from "../../data/forgeRemoteValue";
import type { ForgeResources } from "../../data/forgeResources";
import { ServerIcon } from "../connections/ServerIcon";
import { SheetNavigationPage } from "../../ui/SheetNavigationPage";
import { AppText } from "../../ui/AppText";
import { accountsSheetStyles as styles } from "./accounts/AccountsSheet.styles";
import { ConnectionForgeAccounts } from "./accounts/ConnectionForgeAccounts";
import { AccountsPlaceholder } from "./onboarding/AccountsPlaceholder";
import type { PullRequestsWorkspaceCapabilities } from "./workspaceCapabilities";

import type { ForgeAccountSettingsPage } from "./forgeAccountSettingsPage";

interface ForgeSettingsProps {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly forge: ForgeResources;
  readonly page: ForgeAccountSettingsPage;
}

/** All saved servers share one scroll surface. Account operations stay bound to their own server. */
export function ForgeSettingsSections({
  capabilities,
  connections,
  forge,
  page,
}: ForgeSettingsProps & {
  readonly connections: readonly StoredConnection[];
}): React.JSX.Element {
  if (page.kind !== "list") {
    const connectionId = page.kind === "account" ? page.selection.connectionId : page.connectionId;
    const server = connections.find((candidate) => candidate.id === connectionId);
    if (server?.enabled !== true) {
      return accountsPlaceholder(page, <AppText>Server unavailable</AppText>);
    }
    return (
      <ServerAccounts
        capabilities={capabilities}
        connectionId={server.id}
        forge={forge}
        page={page}
        serverName={server.displayName}
      />
    );
  }
  return (
    <View style={styles.content}>
      {connections.length === 0 ? <AppText>No saved servers</AppText> : null}
      {connections.map((connection) => (
        <View key={connection.id} style={styles.serverSection}>
          <ServerSectionHeading connection={connection} />
          {connection.enabled ? (
            <ServerAccounts
              capabilities={capabilities}
              connectionId={connection.id}
              forge={forge}
              page={page}
              serverName={connection.displayName}
            />
          ) : (
            <AppText>Server disabled</AppText>
          )}
        </View>
      ))}
    </View>
  );
}

function ServerSectionHeading({
  connection,
}: {
  readonly connection: StoredConnection;
}): React.JSX.Element {
  return (
    <View style={styles.serverHeading}>
      <View style={styles.leadingSlot}>
        <ServerIcon iconId={connection.iconId} metric="body" />
      </View>
      <AppText accessibilityRole="header" style={styles.serverName}>
        {connection.displayName}
      </AppText>
    </View>
  );
}

function ServerAccounts({
  capabilities,
  connectionId,
  forge,
  page,
  serverName,
}: ForgeSettingsProps & {
  readonly connectionId: string;
  readonly serverName: string;
}): React.JSX.Element {
  const state = useForgeQuery(forge.accounts, { connectionId });
  const snapshot = remoteValue(state);
  if (snapshot === null) {
    const placeholder = (
      <AccountsPlaceholder
        onRetry={() => {
          void forge.accounts.refresh({ connectionId }).catch(() => undefined);
        }}
        state={state}
      />
    );
    return accountsPlaceholder(page, placeholder);
  }
  return (
    <ConnectionForgeAccounts
      capabilities={capabilities}
      connectionId={connectionId}
      page={page}
      serverName={serverName}
      snapshot={snapshot}
    />
  );
}

function accountsPlaceholder(
  page: ForgeAccountSettingsPage,
  content: React.JSX.Element,
): React.JSX.Element {
  return page.kind === "connect" ? (
    <SheetNavigationPage
      back={{ label: "Back to pull requests", onPress: page.back }}
      title="Connect a provider"
    >
      {content}
    </SheetNavigationPage>
  ) : (
    content
  );
}
