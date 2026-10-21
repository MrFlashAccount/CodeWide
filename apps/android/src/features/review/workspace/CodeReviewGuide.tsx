import { useSelector } from "@legendapp/state/react";
import { StyleSheet, View } from "react-native";

import { remoteValue } from "../../../data/forgeRemoteValue";
import type { DiffSource, HunkCatalog, ThreadId } from "../../../data/reviewContract";
import type { GuideStop } from "../../../data/reviewGuideContract";
import type { ReviewResources } from "../../../data/reviewResources";
import type { ThreadChangeScope } from "../../../data/thread-resource-types";
import { useMinuteClock } from "../../../data/minuteClock";
import { AppButton } from "../../../presentation/controls/AppButton";
import { spacing } from "../../../theme";
import { GuidePanel } from "../guide/GuidePanel";
import type { GuideAuthor, ReviewTargetCapabilities } from "../reviewTargetCapabilities";

/** Everything a session or VCS review needs to show its guide. */
export type CodeReviewGuideBinding = {
  readonly author: GuideAuthor | null;
  readonly authorLabel: string;
  readonly capabilities: ReviewTargetCapabilities;
  readonly connectionId: string;
  readonly describeThread: (threadId: ThreadId) => string;
  readonly resources: Pick<ReviewResources, "guide" | "hunks">;
  /** Review target of the scope the workspace currently shows. */
  readonly sourceFor: (scope: ThreadChangeScope) => DiffSource;
};

/** A line the guide asks the editor to show or comment on. */
export type GuideLine = { readonly line: number; readonly path: string };

function stopLine(catalog: HunkCatalog | null, stop: GuideStop): GuideLine | null {
  for (const id of stop.hunkIds) {
    for (const file of catalog?.files ?? []) {
      const hunk = file.hunks.find((candidate) => candidate.id === id);
      if (hunk !== undefined) {
        return { line: Math.max(1, hunk.newStart), path: file.path };
      }
    }
  }
  return null;
}

/**
 * Guide over a session or VCS review. Stops are located through the source's
 * hunk catalog at the guide's current revision; "Show in diff" reveals the
 * stop in the review editor and Comment opens its inline line comment, which
 * keeps the review's existing composer delivery.
 */
export function CodeReviewGuide({
  binding,
  onComment,
  onReveal,
  scope,
}: {
  readonly binding: CodeReviewGuideBinding;
  readonly onComment: (line: GuideLine) => void;
  readonly onReveal: (line: GuideLine) => void;
  readonly scope: ThreadChangeScope;
}): React.JSX.Element {
  const nowMs = useMinuteClock();
  const source = binding.sourceFor(scope);
  const params = { connectionId: binding.connectionId, source };
  const guide = remoteValue(
    useSelector(() => binding.resources.guide.state$[binding.resources.guide.keyOf(params)]?.get()),
  );
  const hunkParams = guide === null ? null : { ...params, revision: guide.currentRevision };
  if (hunkParams !== null) {
    binding.resources.hunks.ensure(hunkParams);
  }
  const catalog = remoteValue(
    useSelector(() =>
      hunkParams === null
        ? undefined
        : binding.resources.hunks.state$[binding.resources.hunks.keyOf(hunkParams)]?.get(),
    ),
  );
  return (
    <View style={styles.panel} testID="code-review-guide">
      <GuidePanel
        author={binding.author}
        authorLabel={binding.authorLabel}
        capabilities={binding.capabilities}
        connectionId={binding.connectionId}
        describeThread={binding.describeThread}
        nowMs={nowMs}
        onComment={(stop) => {
          const line = stopLine(catalog, stop);
          if (line !== null) {
            onComment(line);
          }
        }}
        renderStopDiff={(stop) => <ShowInDiff line={stopLine(catalog, stop)} onReveal={onReveal} />}
        resources={binding.resources}
        source={source}
      />
    </View>
  );
}

function ShowInDiff({
  line,
  onReveal,
}: {
  readonly line: GuideLine | null;
  readonly onReveal: (line: GuideLine) => void;
}): React.JSX.Element | null {
  if (line === null) {
    return null;
  }
  return (
    <AppButton
      onPress={() => {
        onReveal(line);
      }}
      size="sm"
      variant="outline"
    >
      {`Show ${line.path}:${String(line.line)}`}
    </AppButton>
  );
}

/** The guide takes at most this share of the review height; the diff keeps the rest. */
const GUIDE_MAX_HEIGHT = "45%";

const styles = StyleSheet.create({
  panel: {
    gap: spacing.xs,
    maxHeight: GUIDE_MAX_HEIGHT,
    paddingVertical: spacing.xs,
  },
});
