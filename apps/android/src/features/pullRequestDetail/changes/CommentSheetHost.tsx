import { useSelector } from "@legendapp/state/react";

import type { PullRequestKey } from "../../../data/forgeContract";
import type { PullRequestCommentDestinations } from "../../../data/pullRequestCommentDestinations";
import { CommentSheet } from "../../review/comments/CommentSheet";
import { defaultDestination } from "../../review/comments/destinationPolicy";
import type { DraftComposer } from "./useDraftComposer";

const PR_DESTINATIONS = ["agent", "pr", "both"] as const;

/** Mounts the comment sheet while the composer has a target line. */
export function CommentSheetHost({
  agentThreadTitle,
  composer,
  destinations,
  host,
  ownPullRequest,
  target,
}: {
  readonly agentThreadTitle: string | null;
  readonly composer: DraftComposer;
  readonly destinations: PullRequestCommentDestinations;
  readonly host: string;
  readonly ownPullRequest: boolean;
  readonly target: { readonly connectionId: string; readonly pullRequest: PullRequestKey };
}): React.JSX.Element | null {
  const key = destinations.keyOf(target.connectionId, target.pullRequest);
  destinations.hydrate(target.connectionId, target.pullRequest);
  const remembered = useSelector(() => destinations.destinations$[key]?.get()) ?? null;
  const state = composer.composer;
  if (state.kind !== "new") {
    return null;
  }
  return (
    <CommentSheet
      agentThreadTitle={agentThreadTitle}
      destinations={PR_DESTINATIONS}
      host={host}
      initialDestination={
        state.preferAgent ? "agent" : defaultDestination(remembered, { ownPullRequest })
      }
      onDismiss={composer.close}
      onSubmit={async (body, destination) => {
        destinations.remember(target.connectionId, target.pullRequest, destination);
        await composer.add(state.target, body, destination);
      }}
      ownPullRequest={ownPullRequest}
      target={state.target}
    />
  );
}
