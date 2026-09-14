import type { Observable } from "@legendapp/state";
import type { Collection } from "@tanstack/react-db";
import type { StoredComposerPreferences, StoredDraftAttachment, ThreadUiStateRow } from "./thread-ui-state-types";

export type ThreadUiStateDatabase = {
  collection: Collection<ThreadUiStateRow, string>;
  get(connectionId: string, threadId: string): ThreadUiStateRow | null;
  /** Key-scoped live row. Reading one thread never subscribes to the collection snapshot. */
  row$(connectionId: string, threadId: string): Observable<ThreadUiStateRow | null>;
  /** Stable React resource for the persisted composer/anchor row. */
  read(connectionId: string, threadId: string): Promise<ThreadUiStateRow>;
  getOrCreate(connectionId: string, threadId: string): Promise<ThreadUiStateRow>;
  saveDraft(connectionId: string, threadId: string, text: string): Promise<void>;
  saveAttachments(connectionId: string, threadId: string, attachments: StoredDraftAttachment[]): Promise<void>;
  upsertAttachment(connectionId: string, threadId: string, attachment: StoredDraftAttachment, isCurrent: () => boolean): Promise<void>;
  removeAttachment(connectionId: string, threadId: string, attachmentId: string): Promise<void>;
  saveScrollOffset(connectionId: string, threadId: string, offset: number, historyAnchorTurnId: string | null, historyAnchorOffsetPx: number | null): Promise<void>;
  savePreferences(connectionId: string, threadId: string, preferences: StoredComposerPreferences): Promise<void>;
  deleteConnection(connectionId: string): Promise<void>;
  close(): void;
};
