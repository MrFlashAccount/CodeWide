import { observable } from "@legendapp/state";

import { codeReviewCommentKey, type CodeReviewLineReference } from "./reviewComment";

/** What the line composer holds for one line: the editor's Markdown and its plain text. */
export type LineCommentText = { readonly markdown: string; readonly plainText: string };

const EMPTY_TEXT: LineCommentText = { markdown: "", plainText: "" };

/**
 * The unsent comment text of every line of one review window, kept while the
 * composer sheet is closed. A dictation that finishes after its sheet closed,
 * or after another line opened, still lands on the line it started on, and a
 * refused draft is restored here before its composer reopens.
 */
export type LineCommentDrafts = {
  readonly clear: (line: CodeReviewLineReference) => void;
  /** Identity of the review window; the line voice scope includes it. */
  readonly id: string;
  /** Reads a line's text without subscribing. */
  readonly peek: (line: CodeReviewLineReference) => LineCommentText;
  /** Reads a line's text; inside `useSelector` it subscribes to the window's texts. */
  readonly read: (line: CodeReviewLineReference) => LineCommentText;
  readonly write: (line: CodeReviewLineReference, text: LineCommentText) => void;
};

/** Creates the per-line text owner of one review window. */
export function createLineCommentDrafts(id: string): LineCommentDrafts {
  const texts$ = observable(new Map<string, LineCommentText>());
  return {
    clear: (line) => {
      texts$.delete(codeReviewCommentKey(line));
    },
    id,
    peek: (line) => texts$.peek().get(codeReviewCommentKey(line)) ?? EMPTY_TEXT,
    read: (line) => texts$.get().get(codeReviewCommentKey(line)) ?? EMPTY_TEXT,
    write: (line, text) => {
      texts$.set(codeReviewCommentKey(line), text);
    },
  };
}
