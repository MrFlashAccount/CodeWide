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

export type StoredDraftAttachment = RemoteFileAttachment;

export type ThreadUiStateRow = {
  id: string;
  connectionId: string;
  threadId: string;
  draftText: string;
  attachments: StoredDraftAttachment[];
  scrollOffset: number | null;
  preferences: StoredComposerPreferences | null;
  migratedFromLegacy: boolean;
  updatedAt: number;
};

export type LegacyThreadUiState = Pick<
  ThreadUiStateRow,
  "draftText" | "attachments" | "scrollOffset" | "preferences"
>;
