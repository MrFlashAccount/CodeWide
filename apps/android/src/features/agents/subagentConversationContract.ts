import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";

import type { ThreadWindowHistoryBounds } from "../../data/threadWindowHistoryBounds";
import type { StoredThreadSummary } from "../../data/thread-summary-types";

/** Read-only child conversation input exposed without publishing the agents composition. */
export type SubagentThreadView = {
  readonly compact: boolean;
  readonly connectionId: string;
  readonly historyBounds: ThreadWindowHistoryBounds;
  readonly onBack?: () => void;
  readonly onOpenSubagent: (threadId: string) => void;
  readonly parentBreadcrumb: string | null;
  readonly summary: StoredThreadSummary;
  readonly thread: Thread;
};
