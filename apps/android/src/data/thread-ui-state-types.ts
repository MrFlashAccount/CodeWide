import type { Personality } from "@codewide/codex-protocol/v0.147.0";
import type { RemoteFileAttachment } from "@codewide/sync-client";

export type StoredComposerPreferences = {
  model: string | null;
  effort: string | null;
  personality: Personality | null;
  permissions: string | null;
  skillPaths: string[];
  sendMode: "start" | "queue" | "steer";
};

export type QuickdrawDraftState = {
  kind: "quickdraw";
  mode: "drawing" | "image-annotation";
  snapshot: Record<string, unknown>;
  revision: number;
};

/**
 * Composer-only metadata lives with the durable draft, but is stripped before
 * the remote attachment is sent. This keeps a drawing editable until Send
 * without teaching the sync protocol about Quickdraw documents.
 */
export type StoredDraftAttachment = RemoteFileAttachment & {
  editor?: QuickdrawDraftState;
};

export type ThreadUiStateRow = {
  id: string;
  connectionId: string;
  threadId: string;
  draftText: string;
  attachments: StoredDraftAttachment[];
  scrollOffset: number | null;
  /** Stable viewport cursor. Absent on pre-anchor cache rows. */
  historyAnchorTurnId?: string | null;
  /** Anchor row top relative to the viewport top in pixels. */
  historyAnchorOffsetPx?: number | null;
  preferences: StoredComposerPreferences | null;
  updatedAt: number;
};
