import { useLiveQuery } from "@tanstack/react-db";
import type { ComponentProps } from "react";

import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
import {
  threadListAccountUsageSources,
  type AccountUsageServer,
} from "../../data/thread-list-account-usage";
import { UsagePopover } from "./UsagePopover";

/** Account updates repaint this menu without invalidating the sidebar or conversation. */
export function WorkspaceAccountUsagePopover({
  database,
  servers,
  ...props
}: Omit<ComponentProps<typeof UsagePopover>, "accountSources"> & {
  database: Pick<AccountRateLimitsDatabase, "collection"> | null;
  servers: readonly AccountUsageServer[];
}) {
  const query = useLiveQuery(() => database?.collection, [database]);
  const sources = threadListAccountUsageSources(servers, null, query.data ?? []);
  return <UsagePopover {...props} accountSources={sources} />;
}
