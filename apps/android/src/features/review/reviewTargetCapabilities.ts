import type { DiffSource, DraftId, GuideId, StopId, ThreadId } from "../../data/reviewContract";
import type { DraftComment, DraftInput, SendToAgentOutcome } from "../../data/reviewDraftContract";

/** Who writes a guide: an existing thread, a new read-only thread, or none. */
export type GuideAuthor =
  | { readonly kind: "thread"; readonly threadId: ThreadId }
  | { readonly kind: "newThread"; readonly workspace: string | null };

/**
 * Companion-owned drafts and guides of any diff source. Replay-safe writes are
 * persisted before transport and every settlement re-reads the source's drafts
 * or guide; nothing writes to a forge here.
 */
export type ReviewTargetCapabilities = {
  readonly deleteDraft: (
    connectionId: string,
    draft: Pick<DraftComment, "id" | "revision" | "version">,
  ) => Promise<void>;
  /** Durably saves a draft; an exact lost-response replay returns the same acknowledged draft. */
  readonly putDraft: (
    connectionId: string,
    draft: DraftInput,
    expectedVersion: number | null,
  ) => Promise<DraftComment>;
  readonly requestGuide: (
    connectionId: string,
    request: {
      readonly author: GuideAuthor;
      readonly revision: string;
      readonly source: DiffSource;
    },
  ) => Promise<void>;
  /** PR sources only: delivers each draft's agent half to its own target thread. */
  readonly sendDraftsToAgent: (
    connectionId: string,
    source: DiffSource,
    draftIds: readonly DraftId[],
  ) => Promise<SendToAgentOutcome>;
  readonly setStopState: (
    connectionId: string,
    request: {
      readonly guideId: GuideId;
      readonly revision: string;
      readonly source: DiffSource;
      readonly state: "accepted" | "commented" | "pending";
      readonly stopId: StopId;
    },
  ) => Promise<void>;
};
