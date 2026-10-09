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
import type { ProviderLimitsSource } from "./conversationAccountCapabilities";
import { providerLimitsEntry } from "./providerAccountPresentation";
import { UsageMenu } from "./UsageMenu";

/**
 * Account updates repaint this menu without invalidating the sidebar or conversation.
 * Without an account database (for example a thread whose agent has no account rate
 * limits) the menu shows no account section and opening it reads no account pool;
 * such a thread's provider-level subscription limits come from `providerLimits`.
 */
export function WorkspaceAccountUsageMenu({
  accountsOwnerName,
  agentProviders,
  database,
  providerLimits,
  servers,
  ...props
}: Omit<ComponentProps<typeof UsageMenu>, "accountSources" | "accountsTitle" | "providerLimits"> & {
  /** Pool owner known from the context (a thread's own agent); otherwise read from `agentProviders`. */
  accountsOwnerName?: string | null;
  agentProviders?: Pick<AgentProvidersResource, "state$"> | null;
  database: Pick<AccountRateLimitsDatabase, "collection"> | null;
  /** A thread's own provider whose subscription limits the menu shows (no account pool). */
  providerLimits?: ProviderLimitsSource | null;
  servers: readonly AccountUsageServer[];
}): React.JSX.Element {
  const query = useLiveQuery(() => database?.collection, [database]);
  const providerStates = useSelector(() => agentProviders?.state$.get());
  const providerEntry = useSelector(() =>
    providerLimits === undefined || providerLimits === null
      ? null
      : providerLimitsEntry(
          providerLimits.agentProviders.state$[providerLimits.connectionId]?.get(),
          providerLimits.provider,
        ),
  );
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
      providerLimits={providerEntry}
      {...(sources === undefined ? {} : { accountSources: sources })}
    />
  );
}
