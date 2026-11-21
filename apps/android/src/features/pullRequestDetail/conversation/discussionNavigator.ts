/**
 * The Discussion section's interaction owner: which review threads the user
 * expanded or collapsed, and revealing one thread (from the pinned issues) by
 * expanding it and scrolling the Details page to it. One owner per mounted
 * section; thread cards subscribe only to their own expansion.
 */
import { observable } from "@legendapp/state";
import type { RefObject } from "react";
import type { ScrollView, View } from "react-native";

import type { ReviewThreadId } from "../../../data/forgeConversationContract";
import { spacing } from "../../../theme";

/** Space kept above a revealed thread, so its header is not flush with the page edge. */
const REVEAL_INSET = spacing.md;

/** The Details page's scroll view and the view inside it that thread offsets are measured in. */
export type RevealTarget = {
  readonly content: RefObject<View | null>;
  /** Where `content` starts inside the scroll view's content, for example its padding. */
  readonly contentOffset: number;
  readonly scroll: RefObject<ScrollView | null>;
};

/** Expands threads and scrolls the Details page to one of them. */
export type DiscussionNavigator = {
  /** Registers a thread card's view; the returned function unregisters exactly that view. */
  readonly attach: (threadId: ReviewThreadId, view: View | null) => () => void;
  /**
   * The user's explicit choice for a thread, `null` while it keeps its default.
   * Read inside a selector, it tracks only that thread.
   */
  readonly expanded: (threadId: ReviewThreadId) => boolean | null;
  /** Expands the thread and scrolls it to the top of the page. */
  readonly reveal: (threadId: ReviewThreadId) => void;
  readonly setExpanded: (threadId: ReviewThreadId, expanded: boolean) => void;
};

function noop(): void {
  // A thread that cannot be measured (not laid out yet) keeps the current scroll position.
}

/** Creates the owner of one mounted Discussion section. */
export function createDiscussionNavigator(target: RevealTarget): DiscussionNavigator {
  const views = new Map<ReviewThreadId, View>();
  // A thread without a choice reads `undefined`: Legend answers an absent key that way.
  const choices = observable(new Map<ReviewThreadId, boolean | undefined>());
  return {
    attach: (threadId, view) => {
      if (view === null) {
        return noop;
      }
      views.set(threadId, view);
      return () => {
        if (views.get(threadId) === view) {
          views.delete(threadId);
        }
      };
    },
    expanded: (threadId) => choices.get(threadId).get() ?? null,
    reveal: (threadId) => {
      choices.set(threadId, true);
      const view = views.get(threadId);
      const content = target.content.current;
      const scroll = target.scroll.current;
      if (view === undefined || content === null || scroll === null) {
        return;
      }
      // The thread's top does not move when it expands: only content below it grows.
      view.measureLayout(
        content,
        (_x, y) => {
          scroll.scrollTo({
            animated: true,
            y: Math.max(0, target.contentOffset + y - REVEAL_INSET),
          });
        },
        noop,
      );
    },
    setExpanded: (threadId, expanded) => {
      choices.set(threadId, expanded);
    },
  };
}
