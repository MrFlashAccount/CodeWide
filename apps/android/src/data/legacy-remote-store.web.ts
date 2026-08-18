import type { StoredConnection } from "./connection-profile-types";
import type { StoredComposerPreferences, StoredDraftAttachment } from "./thread-ui-state-types";

export class LegacyRemoteStore {
  static async open(): Promise<LegacyRemoteStore> {
    throw new Error("Legacy migration is available in the Android build only");
  }

  async listConnections(): Promise<StoredConnection[]> { return []; }
  async loadDraft(_connectionId: string, _threadId: string): Promise<string> { return ""; }
  async loadDraftAttachments(_connectionId: string, _threadId: string): Promise<StoredDraftAttachment[]> { return []; }
  async loadScrollOffset(_connectionId: string, _threadId: string): Promise<number | null> { return null; }
  async loadComposerPreferences(_connectionId: string, _threadId: string): Promise<StoredComposerPreferences | null> { return null; }
}
