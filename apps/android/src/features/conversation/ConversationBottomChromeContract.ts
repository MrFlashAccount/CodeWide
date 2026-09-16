import type { ReactElement, ReactNode } from "react";
import type { TimelineItem } from "./timeline/timelineTypes";
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { Dispatch, SetStateAction } from "react";
import type { ThreadCurrentOutcome } from "../../data/thread-current-outcome";

/** Layout and action contract for the conversation's bottom chrome. */
export type ConversationBottomChromeProps = {
  composerContent: ReactElement;
  currentOutcome: ThreadCurrentOutcome | null;
  failureNotice: { acceptsInput: boolean; message: string } | null;
  readOnly: boolean;
  remoteThread: Thread | null | undefined;
  requestPrompt: ReactNode;
  setBottomChromeHeight: Dispatch<SetStateAction<number>>;
  timeline: TimelineItem[];
};
