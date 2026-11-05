import type { DraftDestination } from "../../../data/reviewDraftContract";
import { AppText as Text } from "../../../ui/Typography";
import { commentSheetStyles as styles } from "./CommentSheet.styles";
import { DestinationSegments } from "./DestinationSegments";
import { destinationExplanation } from "./destinationPolicy";

/**
 * "Send to", the explanation of the selected destination and Agent | PR |
 * Both, as the line composer's accessory. PR and Both are offered only for
 * pull-request sources; Agent needs a target thread. Adding a draft writes
 * nothing to a forge: PR drafts leave only through Submit review.
 */
export function CommentDestinationPicker({
  agentThreadTitle,
  destination,
  destinations,
  host,
  onSelect,
  ownPullRequest,
}: {
  /** Thread the agent half goes to, or `null` when no thread can receive it. */
  readonly agentThreadTitle: string | null;
  readonly destination: DraftDestination;
  readonly destinations: readonly DraftDestination[];
  readonly host: string | null;
  readonly onSelect: (destination: DraftDestination) => void;
  readonly ownPullRequest: boolean;
}): React.JSX.Element {
  return (
    <>
      <Text style={styles.label}>Send to</Text>
      <Text style={styles.explanation}>
        {destinationExplanation(destination, {
          host,
          ownPullRequest,
          threadTitle: agentThreadTitle,
        })}
      </Text>
      <DestinationSegments
        agentAvailable={agentThreadTitle !== null}
        destinations={destinations}
        onSelect={onSelect}
        selected={destination}
      />
    </>
  );
}
