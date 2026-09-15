import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { ReactNode } from "react";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useEvent } from "../../react/useEvent";
import type { AppFullscreenOverlayController } from "../../ui/AppFullscreenOverlay";
import { SubagentSheet, type SubagentThreadView } from "./SubagentSheet";

/** The agents owner retains its sheet and consumes only a child-read rendering capability. */
export function useAgentsFeature(
  draftConnectionId: string | null,
  draftThreadId: string | null,
  remoteThread: Thread | null,
  subagentThreadDetails: ThreadDetailDatabase | null,
  onRefreshSubagents: ((threadId: string) => Promise<void>) | undefined,
  fullscreenOverlay: Pick<AppFullscreenOverlayController, "present">,
  renderThread: (view: SubagentThreadView) => ReactNode,
) {
  const openSubagents = useEvent(
    (summaries: readonly StoredThreadSummary[], initialThreadId: string | null = null) => {
      if (draftConnectionId === null || draftThreadId === null || subagentThreadDetails === null)
        return;
      // Opening the sheet is the user event that starts the background catalog
      // refresh. The sheet itself only reads Legend-owned resources.
      void onRefreshSubagents?.(draftThreadId).catch(() => {
        // Retain the complete local subagent list when the server is unavailable.
      });
      fullscreenOverlay.present(
        ({ close }) => (
          <SubagentSheet
            connectionId={draftConnectionId}
            parentThreadId={draftThreadId}
            parentThread={remoteThread ?? null}
            summaries={summaries}
            threadDetails={subagentThreadDetails}
            initialThreadId={initialThreadId}
            renderThread={renderThread}

            onClose={close}
          />
        ),
        { dismissOnScopeUnmount: false },
      );
    },
  );
  return openSubagents;
}
