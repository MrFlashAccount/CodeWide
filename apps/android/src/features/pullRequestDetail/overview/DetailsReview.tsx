import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { DraftComment } from "../../../data/reviewDraftContract";
import { dockCounts } from "../changes/dockCounts";
import { ReviewOutcome, type SubmitResult } from "../changes/ReviewOutcome";
import { SubmitReviewSheet } from "../changes/SubmitReviewSheet";
import type { VerdictChoice } from "./verdictChoice";

/** Everything Details needs to offer Submit review; the screen owns the data and the sheet state. */
export type DetailsReviewProps = {
  readonly bothTargetTitle: string | null;
  readonly choice: VerdictChoice;
  readonly drafts: readonly DraftComment[];
  readonly host: string;
  readonly onClose: () => void;
  /** Opens (or switches) the Submit sheet with one verdict, by its `actionId`. */
  readonly onOpen: (actionId: string) => void;
  /** The verdict the sheet is open with; `null` while it is closed. */
  readonly openVerdictId: string | null;
  readonly result: SubmitResult | null;
  readonly submit: (
    verdict: ActionDescriptor,
    body: string | null,
    forwardBothToAgent: boolean,
  ) => Promise<void>;
  readonly verdicts: readonly ActionDescriptor[];
};

/**
 * The last Submit outcome and the sheet opened from the Details verdict button or menu.
 * The sheet stays the only trigger that publishes a verdict.
 */
export function DetailsReview(props: DetailsReviewProps): React.JSX.Element | null {
  const verdict = props.verdicts.find((item) => item.actionId === props.openVerdictId) ?? null;
  if (props.result === null && verdict === null) {
    return null;
  }
  return (
    <>
      {props.result === null ? null : <ReviewOutcome host={props.host} result={props.result} />}
      {verdict === null ? null : (
        <SubmitReviewSheet
          bothTargetTitle={props.bothTargetTitle}
          counts={dockCounts(props.drafts)}
          host={props.host}
          onDismiss={props.onClose}
          onSelectVerdict={props.onOpen}
          onSubmit={async (body, forward) => props.submit(verdict, body, forward)}
          verdict={verdict}
          verdicts={props.verdicts}
        />
      )}
    </>
  );
}
