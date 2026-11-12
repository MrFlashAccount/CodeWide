import { batch, observable } from "@legendapp/state";

import { codeReviewCommentKey, type CodeReviewLineReference } from "./reviewComment";

/** What the line composer holds for one line: the editor's Markdown and its plain text. */
export type LineCommentText = { readonly markdown: string; readonly plainText: string };

const EMPTY_TEXT: LineCommentText = { markdown: "", plainText: "" };

/**
 * The unsent comment text of every line of one review window, kept while the
 * line composer is closed. A dictation that finishes after its composer closed,
 * or after another line was anchored, still lands on the line it started on,
 * and a refused draft is restored here before its composer reopens.
 */
export type LineCommentDrafts = {
  readonly clear: (line: CodeReviewLineReference) => void;
  /** Identity of the review window; the line voice scope includes it. */
  readonly id: string;
  /**
   * Re-anchors the open composer's text from one line to another. Typed text
   * follows the composer; a text the other line already held moves to the line
   * left behind, so neither is lost. Without typed text the other line keeps its own.
   */
  readonly move: (from: CodeReviewLineReference, to: CodeReviewLineReference) => void;
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
    move: (from, to) => {
      const fromKey = codeReviewCommentKey(from);
      const toKey = codeReviewCommentKey(to);
      const texts = texts$.peek();
      const moving = texts.get(fromKey);
      if (fromKey === toKey || moving === undefined || moving.plainText.trim() === "") {
        return;
      }
      const held = texts.get(toKey);
      batch(() => {
        texts$.set(toKey, moving);
        if (held === undefined || held.plainText.trim() === "") {
          texts$.delete(fromKey);
        } else {
          texts$.set(fromKey, held);
        }
      });
    },
    peek: (line) => texts$.peek().get(codeReviewCommentKey(line)) ?? EMPTY_TEXT,
    read: (line) => texts$.get().get(codeReviewCommentKey(line)) ?? EMPTY_TEXT,
    write: (line, text) => {
      texts$.set(codeReviewCommentKey(line), text);
    },
  };
}
