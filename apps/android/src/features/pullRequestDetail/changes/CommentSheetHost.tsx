import { useSelector } from "@legendapp/state/react";
import { useState } from "react";

import type { PullRequestKey } from "../../../data/forgeContract";
import type { PullRequestCommentDestinations } from "../../../data/pullRequestCommentDestinations";
import type { DraftDestination } from "../../../data/reviewDraftContract";
import type { AppVoiceInputRuntime } from "../../../ui/VoiceInputRuntime";
import { CommentDestinationPicker } from "../../review/comments/CommentDestinationPicker";
import { CommentSheet, type CommentSheetTarget } from "../../review/comments/CommentSheet";
import { defaultDestination } from "../../review/comments/destinationPolicy";
import type { DraftComposer } from "./useDraftComposer";

const PR_DESTINATIONS = ["agent", "pr", "both"] as const;

/** Props of the Changes tab's line composer host. */
type CommentSheetHostProps = {
  readonly agentThreadTitle: string | null;
  readonly composer: DraftComposer;
  readonly destinations: PullRequestCommentDestinations;
  readonly host: string;
  readonly ownPullRequest: boolean;
  readonly target: {
    readonly connectionId: string;
    readonly pullRequest: PullRequestKey;
  };
  readonly voice: AppVoiceInputRuntime | null;
};

/**
 * Mounts the one line composer while a line is chosen. Send closes it at once
 * and adds the draft in the background, so the diff and the review controls
 * stay as they were.
 */
export function CommentSheetHost(props: CommentSheetHostProps): React.JSX.Element | null {
  const { destinations, target } = props;
  const key = destinations.keyOf(target.connectionId, target.pullRequest);
  destinations.hydrate(target.connectionId, target.pullRequest);
  const remembered = useSelector(() => destinations.destinations$[key]?.get()) ?? null;
  const state = props.composer.composer;
  if (state.kind !== "new") {
    return null;
  }
  const preferred =
    state.destination === "remembered"
      ? defaultDestination(remembered, { ownPullRequest: props.ownPullRequest })
      : state.destination;
  return (
    <LineComposer
      agentThreadTitle={props.agentThreadTitle}
      composer={props.composer}
      destinations={destinations}
      host={props.host}
      initialDestination={props.agentThreadTitle === null ? "pr" : preferred}
      key={`${state.target.path}\u0000${state.target.side}\u0000${String(state.target.line)}`}
      line={state.target}
      ownPullRequest={props.ownPullRequest}
      target={target}
      voice={props.voice}
    />
  );
}

/** One open composer with its destination choice. */
function LineComposer({
  agentThreadTitle,
  composer,
  destinations,
  host,
  initialDestination,
  line,
  ownPullRequest,
  target,
  voice,
}: CommentSheetHostProps & {
  readonly initialDestination: DraftDestination;
  readonly line: CommentSheetTarget;
}): React.JSX.Element {
  const [destination, setDestination] = useState(initialDestination);
  return (
    <CommentSheet
      accessory={
        <CommentDestinationPicker
          agentThreadTitle={agentThreadTitle}
          destination={destination}
          destinations={PR_DESTINATIONS}
          host={host}
          onSelect={setDestination}
          ownPullRequest={ownPullRequest}
        />
      }
      drafts={composer.drafts}
      onDismiss={composer.close}
      onSubmit={(body) => {
        destinations.remember(target.connectionId, target.pullRequest, destination);
        composer.add(line, body, destination);
      }}
      submitLabel="Add draft"
      target={line}
      voice={voice}
    />
  );
}
