import type { V2ThreadSettings } from "@codewide/sync-client/v2";

import type { SavedServerId } from "../../domain/ids";
import type { PersistedLocalComposerAttachment } from "./composerAttachmentTransport";
import type { ComposerAttachmentEditorMetadata } from "../composer/composerAttachmentTypes";

export interface PersistedComposerDraftAttachment {
  editor: ComposerAttachmentEditorMetadata | null;
  error: string | null;
  local: PersistedLocalComposerAttachment;
  remoteId: string | null;
  state: "error" | "ready" | "selected";
}

export type PersistedNewThreadWorkspaceMode =
  | { kind: "current" }
  | {
      kind: "isolated";
      support: { canCreate: boolean; provider: string; repositoryRoot: string };
    };

export interface PersistedNewThreadDraft {
  settings: V2ThreadSettings;
  workspace: string | null;
  workspaceMode: PersistedNewThreadWorkspaceMode;
}

export interface PersistedComposerDraft {
  attachments: PersistedComposerDraftAttachment[];
  deliveryMode: "queue" | "sendNow" | "steer";
  draftId: string;
  historyAnchorOffsetPx: number | null;
  historyAnchorTurnId: string | null;
  historyGenerationId: string | null;
  historyPageCursor: string | null;
  historyPageDirection: "newer" | "older" | null;
  newThread: PersistedNewThreadDraft | null;
  savedServerId: SavedServerId;
  text: string;
  updatedAtMs: number;
}

/** Durable V2-only composer state. Invalid rows are purged without exposing their payload. */
export interface ComposerDraftStore {
  delete(savedServerId: SavedServerId, draftId: string): Promise<void>;
  deleteSavedServer(savedServerId: SavedServerId): Promise<void>;
  load(): Promise<PersistedComposerDraft[]>;
  upsert(record: PersistedComposerDraft): Promise<void>;
}
