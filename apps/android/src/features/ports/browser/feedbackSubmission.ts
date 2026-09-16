import { useEvent } from "../../../react/useEvent";
import {
  parseThreadSelectionKey,
  threadSelectionKey,
} from "../../../services/threads/threadRouteParams";
import type { BrowserFeedbackCapability, BrowserFeedbackSubmission } from "./feedback";
import type { FeedbackDelivery } from "./feedbackDelivery";
import { sendBrowserFeedback } from "./send-feedback";

/** Destination qualification happens at each explicit feedback send. */
export function useBrowserFeedbackSubmission(
  connections: readonly { id: string }[],
  scopedThreads: readonly { id: string; serverId: string; title: string }[],
  servers: readonly { id: string; name: string }[],
  delivery: FeedbackDelivery,
) {
  const sendFeedback = useEvent(
    async (submission: BrowserFeedbackSubmission, signal: AbortSignal) => {
      const target = parseThreadSelectionKey(submission.destination);
      if (
        target === null ||
        !connections.some((connection) => connection.id === target.connectionId.value)
      )
        throw new Error("Choose an available destination chat");
      await sendBrowserFeedback(
        delivery,
        {
          connectionId: target.connectionId.value,
          threadId: target.threadId.value,
        },
        submission,
        signal,
      );
    },
  );
  const browserFeedback: Omit<BrowserFeedbackCapability, "initialDestination"> = {
    destinations: scopedThreads.map((thread) => ({
      id: threadSelectionKey(thread),
      label: `${servers.find((server) => server.id === thread.serverId)?.name ?? "Server"} · ${thread.title}`,
    })),
    send: sendFeedback,
  };
  return browserFeedback;
}
