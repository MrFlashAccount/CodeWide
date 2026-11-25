import { createContext } from "react";

import type { ForgeIconSource } from "../../ui/ForgeIcon";

/** One pull request linked to the current thread, as the composer's context chip shows it. */
export type ComposerLinkedPullRequest = {
  /** Companion-resolved mark of the pull request's provider; `null` shows the neutral icon. */
  readonly icon: ForgeIconSource | null;
  /** Opaque, stable identity handed back to `open`; the composer never interprets it. */
  readonly id: string;
  /** The forge's identity of the pull request, e.g. `#115`. */
  readonly label: string;
};

/**
 * Pull requests linked to the current thread that are not already on screen, most relevant
 * first (the thread's canonical review chat, then the most recently linked). The route that
 * mounts the conversation supplies it; the composer only shows the chip and emits `open`.
 */
export type ComposerLinkedPullRequests = {
  readonly items: readonly [ComposerLinkedPullRequest, ...ComposerLinkedPullRequest[]];
  /** Opens that pull request's Details through route-owned navigation. */
  readonly open: (id: string) => void;
};

/** Route-supplied linked pull requests; absent (`null`) outside a thread route or without links. */
export const ComposerLinkedPullRequestContext = createContext<ComposerLinkedPullRequests | null>(
  null,
);
