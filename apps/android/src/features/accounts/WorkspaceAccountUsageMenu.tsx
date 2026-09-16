import { useLiveQuery } from "@tanstack/react-db";
import type { ComponentProps } from "react";

import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
import {
  threadListAccountUsageSources,
  type AccountUsageServer,
} from "../../data/thread-list-account-usage";
import { UsageMenu } from "./UsageMenu";

/** Account updates repaint this menu without invalidating the sidebar or conversation. */
export function WorkspaceAccountUsageMenu({
  database,
  servers,
  ...props
}: Omit<ComponentProps<typeof UsageMenu>, "accountSources"> & {
  database: Pick<AccountRateLimitsDatabase, "collection"> | null;
  servers: readonly AccountUsageServer[];
}): React.JSX.Element {
  const query = useLiveQuery(() => database?.collection, [database]);
  const sources = threadListAccountUsageSources(servers, null, query.data ?? []);
  return <UsageMenu {...props} accountSources={sources} />;
}
