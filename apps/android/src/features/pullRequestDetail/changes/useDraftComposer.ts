import { randomUUID } from "expo-crypto";
import { useId, useState } from "react";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { newDraftId, type DiffSource, type ThreadId } from "../../../data/reviewContract";
import type { DraftComment, DraftDestination, DraftInput } from "../../../data/reviewDraftContract";
import type { DraftPut } from "../../../data/reviewDraftPuts";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { CommentSheetTarget } from "../../review/comments/CommentSheet";
import {
  createLineCommentDrafts,
  type LineCommentDrafts,
} from "../../review/comments/lineCommentDrafts";
import type { ReviewTargetCapabilities } from "../../review/reviewTargetCapabilities";
import { hunkAt } from "./changesPresentation";

const CLOSED = { kind: "closed" } as const;

/**
 * The open line composer: where it comments and which destination it starts
 * on, either a given one (a guide stop's Agent, a restored draft's own) or the
 * one remembered for this PR.
 */
type ComposerState =
  | { readonly kind: "closed" }
  | {
      readonly destination: DraftDestination | "remembered";
      readonly kind: "new";
      readonly target: CommentSheetTarget;
    };

/** Draft creation, restoration and re-anchoring intents of the Changes tab. */
export type DraftComposer = {
  /** Sends a new draft in the background; it is listed at once by `data/reviewDraftPuts`. */
  readonly add: (target: CommentSheetTarget, body: string, destination: DraftDestination) => void;
  readonly close: () => void;
  readonly composer: ComposerState;
  /** Forgets a refused draft without restoring it. */
  readonly discard: (put: DraftPut) => void;
  /** Unsent text per line, kept while the composer is closed. */
  readonly drafts: LineCommentDrafts;
  /** The line whose composer is open, highlighted in the diff as its anchor. */
  readonly line: CommentSheetTarget | null;
  readonly openAt: (target: CommentSheetTarget, preferAgent: boolean) => void;
  readonly reanchoring: DraftComment | null;
  /** Reopens the composer at a refused draft's line with its text and destination. */
  readonly restore: (put: DraftPut) => void;
  readonly startReanchor: (draft: DraftComment) => void;
  readonly tapLine: (target: CommentSheetTarget) => void;
};

/**
 * Creates and re-anchors companion drafts on a PR source. A draft's agent half
 * targets the chosen linked thread; without one only PR is offered. Adding a
 * draft never waits for the companion: the composer closes at once and the
 * draft shows as being saved, or with the companion's reason when refused.
 */
export function useDraftComposer({
  agentThreadId,
  capabilities,
  connectionId,
  files,
  headRevision,
  source,
}: {
  readonly agentThreadId: ThreadId | null;
  readonly capabilities: ReviewTargetCapabilities;
  readonly connectionId: string;
  readonly files: readonly PullRequestFile[];
  readonly headRevision: string;
  readonly source: DiffSource;
}): DraftComposer {
  const dialog = useAppDialog();
  const windowId = useId();
  const drafts = useConstant(() => createLineCommentDrafts(windowId));
  const [composer, setComposer] = useState<ComposerState>(CLOSED);
  const [reanchoring, setReanchoring] = useState<DraftComment | null>(null);
  const anchorAt = (target: CommentSheetTarget) => {
    const file = files.find((candidate) => candidate.path === target.path);
    const hunk = file === undefined ? null : hunkAt(file, target.line, target.side);
    return {
      endLine: target.line,
      hunk: hunk === null ? null : { fingerprint: hunk.fingerprint, id: hunk.id },
      path: target.path,
      side: target.side,
      startLine: target.line,
    };
  };
  const tapLine = useEvent((target: CommentSheetTarget): void => {
    const moving = reanchoring;
    if (moving === null) {
      setComposer({ destination: "remembered", kind: "new", target });
      return;
    }
    setReanchoring(null);
    void capabilities
      .putDraft(connectionId, reinput(moving, anchorAt(target), headRevision), moving.version)
      .catch(() => undefined);
  });
  const add = useEvent(
    (target: CommentSheetTarget, body: string, destination: DraftDestination): void => {
      const base = {
        anchor: anchorAt(target),
        body,
        id: newDraftId(randomUUID()),
        revision: { revision: headRevision, source },
      };
      if (destination !== "pr" && agentThreadId === null) {
        // The destination segments disable Agent and Both without a linked thread.
        dialog.alert("Could not add the draft", "No linked thread can receive the agent half.");
        return;
      }
      const draft: DraftInput =
        destination === "pr" || agentThreadId === null
          ? { ...base, destination: "pr" }
          : { ...base, destination, targetThreadId: agentThreadId };
      // A refusal is shown on the draft itself (`data/reviewDraftPuts`) with Edit and Discard.
      void capabilities.putDraft(connectionId, draft, null).catch(() => undefined);
    },
  );
  const restore = useEvent((put: DraftPut): void => {
    const { anchor } = put.draft;
    const target = { line: anchor.startLine, path: anchor.path, side: anchor.side };
    capabilities.dismissDraftPut(put.operationId);
    drafts.write(target, { markdown: put.draft.body, plainText: put.draft.body });
    setComposer({ destination: put.draft.destination, kind: "new", target });
  });
  const discard = useEvent((put: DraftPut): void => {
    capabilities.dismissDraftPut(put.operationId);
  });
  const close = useEvent((): void => {
    setComposer(CLOSED);
  });
  const openAt = useEvent((target: CommentSheetTarget, preferAgent: boolean): void => {
    setComposer({ destination: preferAgent ? "agent" : "remembered", kind: "new", target });
  });
  return {
    add,
    close,
    composer,
    discard,
    drafts,
    line: composer.kind === "new" ? composer.target : null,
    openAt,
    reanchoring,
    restore,
    startReanchor: setReanchoring,
    tapLine,
  };
}

function reinput(
  draft: DraftComment,
  anchor: DraftInput["anchor"],
  headRevision: string,
): DraftInput {
  const base = {
    anchor,
    body: draft.body,
    id: draft.id,
    revision: { revision: headRevision, source: draft.revision.source },
  };
  if (draft.destination === "pr") {
    return { ...base, destination: "pr" };
  }
  return {
    ...base,
    destination: draft.destination,
    targetThreadId: draft.agent.targetThreadId,
  };
}
