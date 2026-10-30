import type { PullRequestFile } from "../../../data/forgeMutationContract";
import type { DiffSource, ThreadId } from "../../../data/reviewContract";
import type { DraftComment } from "../../../data/reviewDraftContract";
import type { ReviewResources } from "../../../data/reviewResources";
import type { CodeReviewLineReference } from "../../review/comments/reviewComment";
import type { CommentSheetTarget } from "../../review/comments/CommentSheet";
import { GuidePanel } from "../../review/guide/GuidePanel";
import type { ReviewTargetCapabilities } from "../../review/reviewTargetCapabilities";
import { hunkLocations } from "./changesPresentation";
import { PullRequestDiff } from "./PullRequestDiff";

/**
 * Guide over the PR diff. The author is the linked thread, else a new
 * read-only thread in the local checkout (or the companion home). A stop's
 * diff is its first hunk's file, revealed at that hunk.
 */
export function PullRequestGuide({
  agentThread,
  capabilities,
  connectionId,
  describeThread,
  drafts,
  files,
  localWorkspace,
  nowMs,
  offline,
  onComment,
  onLinePress,
  resources,
  source,
}: {
  readonly agentThread: {
    readonly threadId: ThreadId;
    readonly title: string;
  } | null;
  readonly capabilities: ReviewTargetCapabilities;
  readonly connectionId: string;
  readonly describeThread: (threadId: ThreadId) => string;
  readonly drafts: readonly DraftComment[];
  readonly files: readonly PullRequestFile[];
  readonly localWorkspace: string | null;
  readonly nowMs: number;
  readonly offline: boolean;
  readonly onComment: (target: CommentSheetTarget, preferAgent: boolean) => void;
  readonly onLinePress: (reference: CodeReviewLineReference) => void;
  readonly resources: Pick<ReviewResources, "guide">;
  readonly source: DiffSource;
}): React.JSX.Element {
  const locations = hunkLocations(files);
  return (
    <GuidePanel
      author={
        offline
          ? null
          : agentThread === null
            ? { kind: "newThread", workspace: localWorkspace }
            : { kind: "thread", threadId: agentThread.threadId }
      }
      authorLabel={agentThread?.title ?? "A new read-only thread"}
      capabilities={capabilities}
      connectionId={connectionId}
      describeThread={describeThread}
      nowMs={nowMs}
      onComment={(stop, destination) => {
        const first = stop.hunkIds
          .map((id) => locations.get(id))
          .find((location) => location !== undefined);
        if (first !== undefined) {
          onComment({ line: first.line, path: first.path, side: "new" }, destination === "agent");
        }
      }}
      renderStopDiff={(stop) => {
        const first = stop.hunkIds
          .map((id) => locations.get(id))
          .find((location) => location !== undefined);
        const file =
          first === undefined
            ? undefined
            : files.find((candidate) => candidate.path === first.path);
        return file === undefined || first === undefined ? null : (
          <PullRequestDiff
            drafts={drafts}
            headContent={null}
            onLinePress={onLinePress}
            reveal={{ line: first.line, path: first.path, side: "new" }}
            selected={file}
            tree={null}
          />
        );
      }}
      resources={resources}
      source={source}
    />
  );
}
