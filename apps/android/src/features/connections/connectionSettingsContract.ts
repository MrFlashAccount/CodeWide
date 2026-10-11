import type { AccountRateLimitsRow } from "../../data/account-rate-limits";
import type { AgentProvidersResource } from "../../data/agentProvidersResource";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { ConnectionEditorProps } from "./connectionEditorContract";
import type { HostUpdateView } from "./hostUpdateSettingsContract";

export type { HostUpdateView } from "./hostUpdateSettingsContract";

/** Public server settings surface. Its records contain views, never runtime handles. */
export type ConnectionSettingsProps = Omit<
  ConnectionEditorProps,
  "accountPool" | "agentProviders" | "connection"
> & {
  accountRateLimits: AccountRateLimitsRow[];
  /** Provider status of each server, read again whenever its detail page opens. */
  agentProviders?: Pick<AgentProvidersResource, "refresh" | "state$">;
  connections: StoredConnection[];
  hostUpdates: Readonly<Record<string, HostUpdateView>>;
  onApplyHostUpdate: (connectionId: string, targetFingerprint: string) => Promise<void>;
  onApplyRelayUpdate: (connectionId: string, targetFingerprint: string) => Promise<void>;
  onCheckHostUpdate: (connectionId: string) => Promise<void>;
  onCheckRelayUpdate: (connectionId: string) => Promise<void>;
  relayUpdates: Readonly<Record<string, HostUpdateView>>;
};
