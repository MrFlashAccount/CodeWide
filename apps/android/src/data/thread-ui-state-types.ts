import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import type { RemoteFileAttachment } from "@codewide/sync-client";

export type StoredComposerPreferences = {
  effort: string | null;
  model: string | null;
  permissions: string | null;
  personality: Personality | null;
  sendMode: "start" | "queue" | "steer";
  serviceTier: string | null | undefined;
  skillPaths: string[];
};

export type QuickdrawDraftState = {
  kind: "quickdraw";
  mode: "drawing" | "image-annotation";
  revision: number;
  snapshot: Record<string, unknown>;
};

/**
 * Composer-only metadata lives with the durable draft, but is stripped before
 * the remote attachment is sent. This keeps a drawing editable until Send
 * without teaching the sync protocol about Quickdraw documents.
 */
export type StoredDraftAttachment = RemoteFileAttachment & {
  editor?: QuickdrawDraftState;
  preview?: AttachmentPreview;
};

export interface AttachmentPreview {
  readonly bytes: number;
  readonly mimeType: string;
  readonly text: string | null;
  readonly uri: string | null;
}

export type ThreadUiStateRow = {
  attachments: StoredDraftAttachment[];
  connectionId: string;
  draftText: string;
  /** Anchor row top relative to the viewport top in pixels. */
  historyAnchorOffsetPx?: number | null;
  /** Stable viewport cursor. Absent on pre-anchor cache rows. */
  historyAnchorTurnId?: string | null;
  id: string;
  preferences: StoredComposerPreferences | null;
  scrollOffset: number | null;
  threadId: string;
  updatedAt: number;
};
