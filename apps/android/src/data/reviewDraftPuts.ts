/**
 * New drafts the user has added that the companion's drafts snapshot does not
 * hold yet. They are the persisted `companion/review/draft/put` writes in the
 * shared MutationCache, so a screen shows a draft the moment it is sent, keeps
 * showing it while the write is queued offline or replayed after a restart,
 * and shows the companion's reason when it was refused. Re-anchoring an
 * existing draft (`expectedVersion` set) is a move, not a new draft, and is
 * never listed here.
 */
import type { QueryClient } from "@tanstack/react-query";

import { useForgeMutations, type ForgeMutationView } from "./forgeMutationQueue";
import { diffSourceKey, type DiffSource } from "./reviewContract";
import { parseDraftPutParams, type DraftComment, type DraftInput } from "./reviewDraftContract";

const DRAFT_PUT = "companion/review/draft/put";

/** A new draft before the drafts snapshot has it: being saved, or refused with the reason. */
export type DraftPut =
  | { readonly draft: DraftInput; readonly operationId: string; readonly status: "saving" }
  | {
      readonly draft: DraftInput;
      readonly error: string;
      readonly operationId: string;
      readonly status: "failed";
    };

/**
 * The new drafts of one source that `saved` (the drafts snapshot) does not
 * contain, in the order they were sent. An acknowledged write stays listed
 * until its owner has published the saved draft and forgotten the write.
 */
export function useDraftPuts(
  client: QueryClient,
  params: { readonly connectionId: string; readonly source: DiffSource },
  saved: readonly DraftComment[],
): readonly DraftPut[] {
  const sourceKey = diffSourceKey(params.source);
  const views = useForgeMutations(client, DRAFT_PUT, (envelope) => {
    if (envelope.connectionId !== params.connectionId) {
      return false;
    }
    const put = parseDraftPutParams(envelope.params);
    return (
      put !== null &&
      put.expectedVersion === null &&
      diffSourceKey(put.draft.revision.source) === sourceKey
    );
  });
  const savedIds = new Set(saved.map((draft) => draft.id));
  return views.flatMap((view) => {
    const put = draftPutOf(view);
    return put === null || savedIds.has(put.draft.id) ? [] : [put];
  });
}

function draftPutOf(view: ForgeMutationView): DraftPut | null {
  const params = parseDraftPutParams(view.envelope.params);
  if (params === null) {
    return null;
  }
  const operationId = view.envelope.operationId;
  return view.status === "error"
    ? { draft: params.draft, error: view.error, operationId, status: "failed" }
    : { draft: params.draft, operationId, status: "saving" };
}
