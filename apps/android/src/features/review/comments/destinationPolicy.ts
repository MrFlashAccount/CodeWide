/**
 * Default destination of a new line comment (approved UI gate): PR on others'
 * pull requests, Agent on one's own, and the last choice remembered per PR on
 * this device (the caller supplies it). Session and VCS sources only ever have Agent.
 */
import type { DraftDestination } from "../../../data/reviewDraftContract";

/** Destination preselected in the comment sheet. */
export function defaultDestination(
  remembered: DraftDestination | null,
  pullRequest: { readonly ownPullRequest: boolean } | null,
): DraftDestination {
  if (pullRequest === null) {
    return "agent";
  }
  const fallback: DraftDestination = pullRequest.ownPullRequest ? "agent" : "pr";
  return remembered ?? fallback;
}

/** Context of the "Send to" explanation. */
export type DestinationContext = {
  readonly host: string | null;
  readonly ownPullRequest: boolean;
  readonly threadTitle: string | null;
};

/** Explanation under "Send to" for the selected destination; it names where each half lands (N-08). */
export function destinationExplanation(
  destination: DraftDestination,
  context: DestinationContext,
): string {
  const agent = context.threadTitle ?? "the agent";
  const forge = context.host ?? "the forge";
  if (destination === "agent") {
    return `Goes to ${agent}. It never reaches ${forge}.`;
  }
  if (destination === "both") {
    return `Published to ${forge} by Submit review, and sent to ${agent}.`;
  }
  return `${context.ownPullRequest ? "Your" : "Someone else's"} PR. Published to ${forge} only by Submit review.`;
}
