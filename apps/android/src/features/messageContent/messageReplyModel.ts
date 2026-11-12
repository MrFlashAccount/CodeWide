/**
 * Interaction state of one mounted reply input. The typed text lives here,
 * outside React, so typing does not rerender the owner; the editor generation
 * changes only to remount an empty editor after an acknowledged send.
 */
import { observable, type Observable } from "@legendapp/state";

/** Where the typed text is: being edited, awaiting acknowledgement, or back after a failure. */
type ReplySubmission =
  | { readonly message: string; readonly status: "failed" }
  | { readonly status: "editing" }
  | { readonly status: "pending" };

/** State of one reply input. */
export type MessageReplyState = {
  readonly draft: { readonly markdown: string; readonly plainText: string };
  readonly editorGeneration: number;
  readonly submission: ReplySubmission;
};

/** Creates the state owner of one mounted reply input. */
export function createMessageReplyModel(): Observable<MessageReplyState> {
  return observable<MessageReplyState>({
    draft: { markdown: "", plainText: "" },
    editorGeneration: 0,
    submission: { status: "editing" },
  });
}
