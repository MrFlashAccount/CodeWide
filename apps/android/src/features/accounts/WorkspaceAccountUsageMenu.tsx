import { useSelector } from "@legendapp/state/react";
import { useLiveQuery } from "@tanstack/react-db";
import type { ComponentProps } from "react";

import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
import { accountsSectionTitle } from "../../data/account-usage-presentation";
import { accountPoolOwnerName } from "../../data/agentProviders";
import type { AgentProvidersResource } from "../../data/agentProvidersResource";
import {
  threadListAccountUsageSources,
  type AccountUsageServer,
} from "../../data/thread-list-account-usage";
import { UsageMenu } from "./UsageMenu";

/**
 * Account updates repaint this menu without invalidating the sidebar or conversation.
 * Without an account database (for example a thread whose agent has no account rate
 * limits) the menu shows no account section and opening it reads no account pool.
 */
export function WorkspaceAccountUsageMenu({
  accountsOwnerName,
  agentProviders,
  database,
  servers,
  ...props
}: Omit<ComponentProps<typeof UsageMenu>, "accountSources" | "accountsTitle"> & {
  /** Pool owner known from the context (a thread's own agent); otherwise read from `agentProviders`. */
  accountsOwnerName?: string | null;
  agentProviders?: Pick<AgentProvidersResource, "state$"> | null;
  database: Pick<AccountRateLimitsDatabase, "collection"> | null;
  servers: readonly AccountUsageServer[];
}): React.JSX.Element {
  const query = useLiveQuery(() => database?.collection, [database]);
  const providerStates = useSelector(() => agentProviders?.state$.get());
  const ownerNames =
    accountsOwnerName === undefined
      ? servers.map((server) => accountPoolOwnerName(providerStates?.[server.id]))
      : [accountsOwnerName];
  const sources =
    database === null ? undefined : threadListAccountUsageSources(servers, null, query.data ?? []);
  return (
    <UsageMenu
      {...props}
      accountsTitle={accountsSectionTitle(ownerNames)}
      {...(sources === undefined ? {} : { accountSources: sources })}
    />
  );
}
