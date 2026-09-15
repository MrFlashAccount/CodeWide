import type { ReactElement, ReactNode } from "react";
import type { TimelineItem } from "./timeline/timelineTypes";
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { Dispatch, SetStateAction } from "react";
import type { ThreadCurrentOutcome } from "../../data/thread-current-outcome";
export type ConversationBottomChromeProps = {
  setBottomChromeHeight: Dispatch<SetStateAction<number>>;
  readOnly: boolean;
  requestPrompt: ReactNode;
  timeline: TimelineItem[];
  failureNotice: { message: string; acceptsInput: boolean } | null;
  remoteThread: Thread | null | undefined;
  currentOutcome: ThreadCurrentOutcome | null;
  composerContent: ReactElement;
};
