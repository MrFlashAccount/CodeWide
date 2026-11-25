import { useState } from "react";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { DraftComment } from "../../../data/reviewDraftContract";
import { dockCounts } from "./dockCounts";
import { SubmitReviewSheet } from "./SubmitReviewSheet";
import { SubmitSplitButton } from "./SubmitSplitButton";

/**
 * The floating Submit review control: verdict choice (plugin default first)
 * and the Submit sheet. Offline, Submit is disabled and nothing is queued.
 */
export function ReviewSubmitControl({
  bothTargetTitle,
  drafts,
  host,
  offline,
  retry,
  submit,
  verdicts,
}: {
  readonly bothTargetTitle: string | null;
  readonly drafts: readonly DraftComment[];
  readonly host: string;
  readonly offline: boolean;
  readonly retry: boolean;
  readonly submit: (
    verdict: ActionDescriptor,
    body: string | null,
    forwardBothToAgent: boolean,
  ) => Promise<void>;
  readonly verdicts: readonly ActionDescriptor[];
}): React.JSX.Element {
  const [verdictId, setVerdictId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const enabled = verdicts.filter((verdict) => verdict.availability.state === "enabled");
  const verdict = verdicts.find((item) => item.actionId === verdictId) ?? enabled[0] ?? null;
  const counts = dockCounts(drafts);
  return (
    <>
      <SubmitSplitButton
        accessibilityLabel={submitAccessibilityLabel(retry, verdict, counts.total)}
        disabled={offline || verdict === null}
        label={submitLabel(retry, counts.total)}
        onOpenSubmit={() => {
          setOpen(true);
        }}
        onSelectVerdict={setVerdictId}
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

function submitLabel(retry: boolean, drafts: number): string {
  if (retry) {
    return "Retry";
  }
  return drafts === 0 ? "Review" : `Review · ${String(drafts)}`;
}

function submitAccessibilityLabel(
  retry: boolean,
  verdict: ActionDescriptor | null,
  drafts: number,
): string {
  const action = retry
    ? "Retry submit"
    : verdict === null
      ? "Submit review"
      : `Submit review · ${verdict.label}`;
  return drafts === 0
    ? action
    : `${action}, ${String(drafts)} ${drafts === 1 ? "draft" : "drafts"}`;
}
