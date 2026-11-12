import { randomUUID } from "expo-crypto";
import { useId, useState } from "react";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { newDraftId, type DiffSource } from "../../../data/reviewContract";
import type { DraftComment, DraftInput } from "../../../data/reviewDraftContract";
import type { DraftPut } from "../../../data/reviewDraftPuts";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import type { LineCommentTarget } from "../../review/comments/LineCommentComposer";
import {
  createLineCommentDrafts,
  type LineCommentDrafts,
} from "../../review/comments/lineCommentDrafts";
import type { ReviewTargetCapabilities } from "../../review/reviewTargetCapabilities";
import { hunkAt } from "./changesPresentation";

/** Draft creation, restoration and re-anchoring intents of the Changes tab. */
export type DraftComposer = {
  /** Sends a new PR draft in the background; it is listed at once by `data/reviewDraftPuts`. */
  readonly add: (target: LineCommentTarget, body: string) => void;
  readonly close: () => void;
  /** Forgets a refused draft without restoring it. */
  readonly discard: (put: DraftPut) => void;
  /** Unsent text per line, kept while the composer is closed. */
  readonly drafts: LineCommentDrafts;
  /** The line whose composer is open, highlighted in the diff as its anchor. */
  readonly line: LineCommentTarget | null;
  /** Opens the composer at a line, or re-anchors the open one there with its text. */
  readonly openAt: (target: LineCommentTarget) => void;
  readonly reanchoring: DraftComment | null;
  /** Reopens the composer at a refused draft's line with its text. */
  readonly restore: (put: DraftPut) => void;
  readonly startReanchor: (draft: DraftComment) => void;
  readonly tapLine: (target: LineCommentTarget) => void;
};

/**
 * Creates and re-anchors companion drafts on a PR source. A line comment is a
 * PR review draft; it reaches the forge only through Submit review. Adding a
 * draft never waits for the companion: the composer closes at once and the
 * draft shows as being saved, or with the companion's reason when refused.
 */
export function useDraftComposer({
  capabilities,
  connectionId,
  files,
  headRevision,
  source,
}: {
  readonly capabilities: ReviewTargetCapabilities;
  readonly connectionId: string;
  readonly files: readonly PullRequestFile[];
  readonly headRevision: string;
  readonly source: DiffSource;
}): DraftComposer {
  const windowId = useId();
  const drafts = useConstant(() => createLineCommentDrafts(windowId));
  const [line, setLine] = useState<LineCommentTarget | null>(null);
  const [reanchoring, setReanchoring] = useState<DraftComment | null>(null);
  const anchorAt = (target: LineCommentTarget) => {
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
  const openAt = useEvent((target: LineCommentTarget): void => {
    if (line !== null) {
      drafts.move(line, target);
    }
    setLine(target);
  });
  const tapLine = useEvent((target: LineCommentTarget): void => {
    const moving = reanchoring;
    if (moving === null) {
      openAt(target);
      return;
    }
    setReanchoring(null);
    void capabilities
      .putDraft(connectionId, reinput(moving, anchorAt(target), headRevision), moving.version)
      .catch(() => undefined);
  });
  const add = useEvent((target: LineCommentTarget, body: string): void => {
    const draft: DraftInput = {
      anchor: anchorAt(target),
      body,
      destination: "pr",
      id: newDraftId(randomUUID()),
      revision: { revision: headRevision, source },
    };
    // A refusal is shown on the draft itself (`data/reviewDraftPuts`) with Edit and Discard.
    void capabilities.putDraft(connectionId, draft, null).catch(() => undefined);
  });
  const restore = useEvent((put: DraftPut): void => {
    const { anchor } = put.draft;
    const target = { line: anchor.startLine, path: anchor.path, side: anchor.side };
    capabilities.dismissDraftPut(put.operationId);
    drafts.write(target, { markdown: put.draft.body, plainText: put.draft.body });
    setLine(target);
  });
  const discard = useEvent((put: DraftPut): void => {
    capabilities.dismissDraftPut(put.operationId);
  });
  const close = useEvent((): void => {
    setLine(null);
  });
  return {
    add,
    close,
    discard,
    drafts,
    line,
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
