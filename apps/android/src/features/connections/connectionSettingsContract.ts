import type { AccountRateLimitsRow } from "../../data/account-rate-limits";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { ConnectionEditorProps } from "./connectionEditorContract";

/** Public server settings surface. Its records contain views, never runtime handles. */
export type ConnectionSettingsProps = Omit<ConnectionEditorProps, "connection" | "accountPool"> & {
  connections: StoredConnection[];
  accountRateLimits: AccountRateLimitsRow[];
};
