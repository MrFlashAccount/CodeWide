import { randomUUID } from "expo-crypto";
import { useState } from "react";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { newDraftId, type DiffSource, type ThreadId } from "../../../data/reviewContract";
import type { DraftComment, DraftDestination, DraftInput } from "../../../data/reviewDraftContract";
import { useEvent } from "../../../react/useEvent";
import type { CommentSheetTarget } from "../../review/comments/CommentSheet";
import type { ReviewTargetCapabilities } from "../../review/reviewTargetCapabilities";
import { hunkAt } from "./changesPresentation";

const CLOSED = { kind: "closed" } as const;

/** Open comment sheet: a new draft at a line, or moving an outdated draft there. */
type ComposerState =
  | { readonly kind: "closed" }
  | { readonly kind: "new"; readonly preferAgent: boolean; readonly target: CommentSheetTarget };

/** Draft creation and re-anchoring intents of the Changes tab. */
export type DraftComposer = {
  readonly add: (
    target: CommentSheetTarget,
    body: string,
    destination: DraftDestination,
  ) => Promise<void>;
  readonly close: () => void;
  readonly composer: ComposerState;
  readonly openAt: (target: CommentSheetTarget, preferAgent: boolean) => void;
  readonly reanchoring: DraftComment | null;
  readonly startReanchor: (draft: DraftComment) => void;
  readonly tapLine: (target: CommentSheetTarget) => void;
};

/**
 * Creates and re-anchors companion drafts on a PR source. A draft's agent half
 * targets the chosen linked thread; without one only PR is offered.
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
      setComposer({ kind: "new", preferAgent: false, target });
      return;
    }
    setReanchoring(null);
    void capabilities
      .putDraft(connectionId, reinput(moving, anchorAt(target), headRevision), moving.version)
      .catch(() => undefined);
  });
  const add = useEvent(
    async (
      target: CommentSheetTarget,
      body: string,
      destination: DraftDestination,
    ): Promise<void> => {
      const base = {
        anchor: anchorAt(target),
        body,
        id: newDraftId(randomUUID()),
        revision: { revision: headRevision, source },
      };
      if (destination !== "pr" && agentThreadId === null) {
        throw new Error("No linked thread can receive the agent half");
      }
      const draft: DraftInput =
        destination === "pr" || agentThreadId === null
          ? { ...base, destination: "pr" }
          : { ...base, destination, targetThreadId: agentThreadId };
      await capabilities.putDraft(connectionId, draft, null);
    },
  );
  return {
    add,
    close: () => {
      setComposer(CLOSED);
    },
    composer,
    openAt: (target, preferAgent) => {
      setComposer({ kind: "new", preferAgent, target });
    },
    reanchoring,
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
  return { ...base, destination: draft.destination, targetThreadId: draft.agent.targetThreadId };
}
