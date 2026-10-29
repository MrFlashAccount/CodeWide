import type { ScenarioStartOutcome } from "../../data/forgeMutationContract";
import type { ThreadId } from "../../data/reviewContract";
import type { DeferReviewChatScenario } from "./pullRequestScreenContract";
import type { ReviewChatWorkspace } from "./workspaceCapabilities";

/**
 * Starts a scenario in the PR's review chat without letting the Companion pick a directory: a
 * start that needs one is deferred to the review-chat draft, which starts it again in the
 * project the user confirms there. Settles with the started thread, or `null` when the draft is
 * dismissed.
 */
export async function startInReviewChat(
  label: string,
  start: (workspace: ReviewChatWorkspace) => Promise<ScenarioStartOutcome>,
  defer: DeferReviewChatScenario,
): Promise<ThreadId | null> {
  const outcome = await start({ kind: "ask" });
  if (outcome.kind === "started") {
    return outcome.threadId;
  }
  return defer({
    candidates: outcome.candidates,
    label,
    start: async (path) => {
      const chosen = await start({ kind: "path", path });
      if (chosen.kind !== "started") {
        throw new Error("Choose a project folder for the review chat");
      }
      return chosen.threadId;
    },
  });
}
