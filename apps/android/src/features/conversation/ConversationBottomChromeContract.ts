import type { ReactElement, ReactNode } from "react";
import type { TimelineItem } from "./timeline/timelineTypes";
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { ThreadCurrentOutcome } from "../../data/thread-current-outcome";

/** Layout and action contract for the conversation's bottom chrome. */
export type ConversationBottomChromeProps = {
  composerContent: ReactElement;
  currentOutcome: ThreadCurrentOutcome | null;
  failureNotice: {
    acceptsInput: boolean;
    kind: "conversationOpenElsewhere" | "generic";
    message: string;
  } | null;
  /**
   * The open-elsewhere bar's actions; `null` on a surface that shows no bar
   * (a sub-agent's read surface).
   */
  openElsewhereActions: {
    readonly onCheckAgain: () => Promise<void>;
    readonly onFork: (() => void) | null;
  } | null;
  readOnly: boolean;
  remoteThread: Thread | null | undefined;
  reportBottomChromeHeight: (height: number) => void;
  requestPrompt: ReactNode;
  timeline: TimelineItem[];
};
