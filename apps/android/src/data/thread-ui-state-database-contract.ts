import type { Observable } from "@legendapp/state";
import type {
  StoredComposerPreferences,
  StoredDraftAttachment,
  ThreadUiStateRow,
} from "./thread-ui-state-types";

/** Persists per-thread UI state independently from authoritative thread data. */
export type ThreadUiStateDatabase = {
  close: () => void;
  deleteConnection: (connectionId: string) => Promise<void>;
  deleteThread: (connectionId: string, threadId: string) => Promise<void>;
  get: (connectionId: string, threadId: string) => ThreadUiStateRow | null;
  getOrCreate: (connectionId: string, threadId: string) => Promise<ThreadUiStateRow>;
  /** Stable React resource for the persisted composer/anchor row. */
  read: (connectionId: string, threadId: string) => Promise<ThreadUiStateRow>;
  /** Prepares the durable schema without hydrating every persisted thread row. */
  ready: Promise<void>;
  removeAttachment: (connectionId: string, threadId: string, attachmentId: string) => Promise<void>;
  /** Retains the key-scoped React resource until its mounted consumer releases it. */
  retain: (connectionId: string, threadId: string) => () => void;
  /** Key-scoped live row. Reading one thread never subscribes to the collection snapshot. */
  row$: (connectionId: string, threadId: string) => Observable<ThreadUiStateRow | null>;
  saveAttachments: (
    connectionId: string,
    threadId: string,
    attachments: StoredDraftAttachment[],
  ) => Promise<void>;
  saveDraft: (connectionId: string, threadId: string, text: string) => Promise<void>;
  savePreferences: (
    connectionId: string,
    threadId: string,
    preferences: StoredComposerPreferences,
  ) => Promise<void>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  saveScrollOffset: (
    connectionId: string,
    threadId: string,
    offset: number,
    historyAnchorTurnId: string | null,
    historyAnchorOffsetPx: number | null,
  ) => Promise<void>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  upsertAttachment: (
    connectionId: string,
    threadId: string,
    attachment: StoredDraftAttachment,
    isCurrent: () => boolean,
  ) => Promise<void>;
};
