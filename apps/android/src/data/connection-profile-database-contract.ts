import type { Collection } from "@tanstack/react-db";
import type { ConnectionInput, ConnectionUpdateInput } from "./connection-validation";
import type { ConnectionProfileRow, StoredConnection } from "./connection-profile-types";

/** Owns persisted connection profiles and their migration into runtime records. */
export type ConnectionProfileDatabase = {
  add: (input: ConnectionInput, connectionId?: string) => Promise<StoredConnection>;
  close: () => void;
  collection: Collection<ConnectionProfileRow, string>;
  delete: (connectionId: string) => Promise<void>;
  hydrate: (rows?: ConnectionProfileRow[]) => Promise<StoredConnection[]>;
  importLegacy: (connections: StoredConnection[]) => Promise<void>;
  importLegacyUiCache: () => Promise<void>;
  migrateLegacyCredentials: (
    migrate: (connection: StoredConnection) => Promise<void>,
  ) => Promise<void>;
  move: (connectionId: string, direction: -1 | 1) => Promise<void>;
  project: (rows?: ConnectionProfileRow[]) => StoredConnection[];
  purgeLegacyCredentials: (connectionIds: string[]) => Promise<void>;
  reconcileRuntimeConfigs: (configs: RuntimeConnectionConfig[]) => Promise<void>;
  setEnabled: (connectionId: string, enabled: boolean) => Promise<void>;
  update: (connectionId: string, input: ConnectionUpdateInput) => Promise<ConnectionUpdateInput>;
  updateProfile: (connectionId: string, displayName: string, emoji: string) => Promise<void>;
};

/** Validated connection fields required to start a remote runtime. */
export type RuntimeConnectionConfig = {
  connectionId: string;
  enabled: boolean;
  endpoint: string;
  tlsPinSha256: string | null;
};
