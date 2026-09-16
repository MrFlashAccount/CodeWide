import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

import type { StoredThreadSummary } from "../../data/thread-summary-types";

/** Read-only conversation input exposed without publishing the agent route composition. */
export type SubagentThreadView = {
  readonly compact: boolean;
  readonly connectionId: string;
  readonly onBack?: () => void;
  readonly onOpenSubagent: (threadId: string) => void;
  readonly summary: StoredThreadSummary;
  readonly thread: Thread;
};
