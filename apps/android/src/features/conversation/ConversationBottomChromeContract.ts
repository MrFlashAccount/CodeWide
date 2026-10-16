import type { ReactElement, ReactNode } from "react";
import type { TimelineItem } from "./timeline/timelineTypes";
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { ThreadCurrentOutcome } from "../../data/thread-current-outcome";
import type { ThreadWriteOwnership } from "../../data/thread-cursor-sync";
import type { ThreadForkOptions } from "../../data/thread-fork";

/** Layout and action contract for the conversation's bottom chrome. */
export type ConversationBottomChromeProps = {
  composerContent: ReactElement;
  currentOutcome: ThreadCurrentOutcome | null;
  failureNotice: {
    acceptsInput: boolean;
    kind: "conversationOpenElsewhere" | "generic";
    message: string;
  } | null;
  onFork: ((options: ThreadForkOptions) => Promise<void>) | undefined;
  onRetryWriteOwnership: (() => Promise<void>) | undefined;
  readOnly: boolean;
  remoteThread: Thread | null | undefined;
  reportBottomChromeHeight: (height: number) => void;
  requestPrompt: ReactNode;
  timeline: TimelineItem[];
  writeOwnership: ThreadWriteOwnership;
};
