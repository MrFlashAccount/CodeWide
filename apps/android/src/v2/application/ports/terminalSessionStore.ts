import type { V2U64 } from "@codewide/sync-client/v2";

import type { SavedServerId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";

/**
 * Durable identity needed to reattach a Companion-owned terminal after Android process death.
 * Render and replay cursors are deliberately volatile: a new VT must rebuild from server replay.
 */
export interface TerminalSessionRecord {
  cols: number;
  cwd: string | null;
  generation: V2U64;
  id: string;
  owner: QualifiedThread;
  rows: number;
  title: string;
}

export interface TerminalSessionStore {
  delete(id: string): Promise<void>;
  deleteSavedServer(savedServerId: SavedServerId): Promise<void>;
  list(): Promise<readonly TerminalSessionRecord[]>;
  upsert(record: TerminalSessionRecord): Promise<void>;
}

export function createVolatileTerminalSessionStore(): TerminalSessionStore {
  const records = new Map<string, TerminalSessionRecord>();
  return {
    async delete(id) {
      records.delete(id);
      await Promise.resolve();
    },
    async deleteSavedServer(savedServerId) {
      for (const [id, record] of records) {
        if (record.owner.savedServerId === savedServerId) records.delete(id);
      }
      await Promise.resolve();
    },
    async list() {
      await Promise.resolve();
      return [...records.values()];
    },
    async upsert(record) {
      records.set(record.id, record);
      await Promise.resolve();
    },
  };
}
