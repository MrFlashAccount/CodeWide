import { useEvent } from "../../../react/useEvent";
import { useAsyncAction, type AsyncActionState } from "../../presentation/actions/useAsyncAction";
import type { V2RenderingCapabilities } from "../renderingCapabilities";

interface ReviewSelection {
  end: number;
  start: number;
  text: string;
}

interface UseReviewSelectionActionInput {
  beginReview: V2RenderingCapabilities["beginReview"];
  blockPath: string | undefined;
  offset: number;
  targetId: string | undefined;
}

interface ReviewSelectionAction {
  action: AsyncActionState;
  activate(selection: ReviewSelection): void;
}

/** Adapts a native text selection into one retryable V2 review activation. */
export function useReviewSelectionAction(
  input: UseReviewSelectionActionInput,
): ReviewSelectionAction {
  const action = useAsyncAction();
  const activate = useEvent((selection: ReviewSelection): void => {
    if (
      input.beginReview === undefined ||
      input.blockPath === undefined ||
      input.targetId === undefined
    ) {
      return;
    }
    const beginReview = input.beginReview;
    const blockPath = input.blockPath;
    const targetId = input.targetId;
    action.run({
      action: async () => {
        await beginReview({
          blockPath,
          end: input.offset + selection.end,
          kind: "text",
          quote: selection.text,
          start: input.offset + selection.start,
          targetId,
        });
      },
      failure: "Could not start text review.",
      pending: "Starting text review…",
    });
  });
  return { action, activate };
}
