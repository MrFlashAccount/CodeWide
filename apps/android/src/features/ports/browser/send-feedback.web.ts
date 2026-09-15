import type { BrowserFeedbackSubmission } from "./feedback";
import type { FeedbackDelivery, FeedbackTarget } from "./feedbackDelivery";

export async function sendBrowserFeedback(
  _remote: FeedbackDelivery,
  _target: FeedbackTarget,
  _submission: BrowserFeedbackSubmission,
  _signal: AbortSignal,
): Promise<void> {
  throw new Error("Browser feedback is available in the Android application");
}
