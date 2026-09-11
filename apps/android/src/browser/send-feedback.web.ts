import type { RemoteWorkspace } from "../data/use-remote-workspace";
import type { BrowserFeedbackSubmission } from "./feedback";
interface FeedbackTarget { readonly connectionId: string; readonly threadId: string }
export async function sendBrowserFeedback(_remote: RemoteWorkspace, _target: FeedbackTarget, _submission: BrowserFeedbackSubmission, _signal: AbortSignal): Promise<void> {
  throw new Error("Browser feedback is available in the Android application");
}
