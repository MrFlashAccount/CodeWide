import { useState } from "react";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { DraftComment } from "../../../data/reviewDraftContract";
import type {
  PullRequestDetailWorkspaceCapabilities,
  PullRequestTarget,
} from "../workspaceCapabilities";
import { dockCounts } from "./dockCounts";
import { ReviewDock } from "./ReviewDock";
import { SubmitReviewSheet } from "./SubmitReviewSheet";
import { useSubmitReview } from "./useSubmitReview";

/**
 * Binds the review dock to Submit: verdict choice (plugin default first), the
 * Submit sheet and its acknowledged outcome. Offline, Submit is disabled and
 * nothing is queued.
 */
export function ChangesReviewDock({
  bothTargetTitle,
  capabilities,
  drafts,
  host,
  offline,
  onStale,
  target,
  verdicts,
}: {
  readonly bothTargetTitle: string | null;
  readonly capabilities: PullRequestDetailWorkspaceCapabilities;
  readonly drafts: readonly DraftComment[];
  readonly host: string;
  readonly offline: boolean;
  readonly onStale: (kind: "outcomeUnknown" | "stale") => void;
  readonly target: PullRequestTarget;
  readonly verdicts: readonly ActionDescriptor[];
}): React.JSX.Element {
  const [verdictId, setVerdictId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const { result, submit } = useSubmitReview({ capabilities, drafts, onStale, target });
  const enabled = verdicts.filter((verdict) => verdict.availability.state === "enabled");
  const verdict = verdicts.find((item) => item.actionId === verdictId) ?? enabled[0] ?? null;
  const counts = dockCounts(drafts);
  return (
    <>
      <ReviewDock
        counts={counts}
        disabled={offline || verdict === null}
        host={host}
        onOpenSubmit={() => {
          setOpen(true);
        }}
        onSelectVerdict={setVerdictId}
        result={result}
        verdict={verdict}
        verdicts={verdicts}
      />
      {open && verdict !== null ? (
        <SubmitReviewSheet
          bothTargetTitle={bothTargetTitle}
          counts={counts}
          host={host}
          onDismiss={() => {
            setOpen(false);
          }}
          onSelectVerdict={setVerdictId}
          onSubmit={async (body, forward) => submit(verdict, body, forward)}
          verdict={verdict}
          verdicts={verdicts}
        />
      ) : null}
    </>
  );
}
