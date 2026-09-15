import type { Collection } from "@tanstack/react-db";
import type { ConnectionInput, ConnectionUpdateInput } from "./connection-validation";
import type { ConnectionProfileRow, StoredConnection } from "./connection-profile-types";

/** Owns persisted connection profiles and their migration into runtime records. */
export type ConnectionProfileDatabase = {
  collection: Collection<ConnectionProfileRow, string>;
  project(rows?: ConnectionProfileRow[]): StoredConnection[];
  importLegacyUiCache(): Promise<void>;
  importLegacy(connections: StoredConnection[]): Promise<void>;
  hydrate(rows?: ConnectionProfileRow[]): Promise<StoredConnection[]>;
  migrateLegacyCredentials(migrate: (connection: StoredConnection) => Promise<void>): Promise<void>;
  purgeLegacyCredentials(connectionIds: string[]): Promise<void>;
  reconcileRuntimeConfigs(configs: RuntimeConnectionConfig[]): Promise<void>;
  add(input: ConnectionInput, connectionId?: string): Promise<StoredConnection>;
  delete(connectionId: string): Promise<void>;
  setEnabled(connectionId: string, enabled: boolean): Promise<void>;
  updateProfile(connectionId: string, displayName: string, emoji: string): Promise<void>;
  update(connectionId: string, input: ConnectionUpdateInput): Promise<ConnectionUpdateInput>;
  move(connectionId: string, direction: -1 | 1): Promise<void>;
  close(): void;
};

/** Validated connection fields required to start a remote runtime. */
export type RuntimeConnectionConfig = {
  connectionId: string;
  endpoint: string;
  tlsPinSha256: string | null;
  enabled: boolean;
};
