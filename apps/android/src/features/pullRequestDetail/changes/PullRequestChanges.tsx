import { StyleSheet, View } from "react-native";

import type { DraftId } from "../../../data/reviewContract";
import { useEvent } from "../../../react/useEvent";
import { colors, layoutSize, radii, spacing } from "../../../theme";
import { useAppDialog } from "../../../ui/AppDialog";
import type { CodeReviewLineReference } from "../../review/comments/reviewComment";
import { ChangesHeader } from "./ChangesHeader";
import { viewedSummary } from "./changesPresentation";
import { ChangesReviewDock } from "./ChangesReviewDock";
import { CommentSheetHost } from "./CommentSheetHost";
import { FilesView } from "./FilesView";
import { PullRequestGuide } from "./PullRequestGuide";
import type { PullRequestChangesProps } from "./changesContract";
import { useChangesData, type ChangesData } from "./useChangesData";
import { useDraftComposer, type DraftComposer } from "./useDraftComposer";

/**
 * Changes: Files or Guide over the forge diff, companion drafts with their
 * axes, the comment sheet and the review dock. Files, drafts and guide are
 * progressive resources; already published data stays visible while they refresh.
 */
export function PullRequestChanges(props: PullRequestChangesProps): React.JSX.Element {
  const { connectionId, model, overview } = props;
  const dialog = useAppDialog();
  const data = useChangesData(props);
  const agentThread = props.agentThread;
  const composer = useDraftComposer({
    agentThreadId: agentThread === null ? null : agentThread.threadId,
    capabilities: props.reviewCapabilities,
    connectionId,
    files: data.page === null ? [] : data.page.files,
    headRevision: overview.headRevision,
    source: data.source,
  });
  const sendToAgent = useEvent((draftIds: readonly DraftId[]): void => {
    props.reviewCapabilities
      .sendDraftsToAgent(connectionId, data.source, draftIds)
      .catch((error: unknown) => {
        dialog.error("Could not send to the agent", error);
      });
  });
  const agentTitle = agentThread === null ? null : agentThread.title;
  return (
    <View style={styles.fill} testID="pull-request-changes">
      <ChangesHeader
        onSelect={(next) => {
          model.changesView.set(next);
        }}
        summary={data.page === null ? "" : viewedSummary(data.page.files)}
        view={data.view}
      />
      <ChangesBody
        composer={composer}
        data={data}
        onLinePress={composer.tapLine}
        onSendToAgent={sendToAgent}
        props={props}
      />
      <ChangesReviewDock
        bothTargetTitle={agentTitle}
        capabilities={props.capabilities}
        drafts={data.drafts}
        host={props.host}
        offline={props.offline}
        onStale={props.onStale}
        target={data.target}
        verdicts={props.verdicts}
      />
      <CommentSheetHost
        agentThreadTitle={agentTitle}
        composer={composer}
        destinations={props.commentDestinations}
        host={props.host}
        ownPullRequest={props.ownPullRequest}
        target={{ connectionId, pullRequest: overview.pullRequest }}
      />
    </View>
  );
}

/** Files or Guide over the loaded files page; a stable skeleton owns the first load. */
function ChangesBody({
  composer,
  data,
  onLinePress,
  onSendToAgent,
  props,
}: {
  readonly composer: DraftComposer;
  readonly data: ChangesData;
  readonly onLinePress: (reference: CodeReviewLineReference) => void;
  readonly onSendToAgent: (draftIds: readonly DraftId[]) => void;
  readonly props: PullRequestChangesProps;
}): React.JSX.Element {
  const { connectionId, model, overview } = props;
  const dialog = useAppDialog();
  const { page } = data;
  if (page === null) {
    return <ChangesSkeleton />;
  }
  return (
    <>
      {data.view === "files" ? (
        <FilesView
          drafts={data.drafts}
          fileActions={props.fileActions}
          host={props.host}
          onDeleteDraft={(draft) => {
            props.reviewCapabilities.deleteDraft(connectionId, draft).catch((error: unknown) => {
              dialog.error("Could not delete the draft", error);
            });
          }}
          onLinePress={onLinePress}
          onLoadMore={
            page.nextCursor === null
              ? null
              : () => {
                  props.forge.loadMoreFiles(data.target).catch(() => undefined);
                }
          }
          onReanchor={composer.startReanchor}
          onRun={props.onRun}
          onSelect={(file) => {
            model.selectedPath.set(file.path);
          }}
          onSendToAgent={(draft) => {
            onSendToAgent([draft.id]);
          }}
          onToggleViewed={data.toggleViewed}
          page={page}
          selected={data.selected}
          tablet={props.tablet}
          viewedPending={data.viewedPending}
        />
      ) : null}
      {data.view === "guide" ? (
        <PullRequestGuide
          agentThread={props.agentThread}
          capabilities={props.reviewCapabilities}
          connectionId={connectionId}
          describeThread={props.describeThread}
          drafts={data.drafts}
          files={page.files}
          localWorkspace={overview.localCheckout?.workspace ?? null}
          nowMs={props.nowMs}
          offline={props.offline}
          onComment={composer.openAt}
          onLinePress={onLinePress}
          resources={props.review}
          source={data.source}
        />
      ) : null}
    </>
  );
}

const SKELETON_ROWS = ["first", "second", "third", "fourth"] as const;
const ALTERNATING_ROW_DIVISOR = 2;
const SHORT_ROW_REMAINDER = 1;
const SKELETON_META_HEIGHT = 10;
const SKELETON_PATH_HEIGHT = 12;

function ChangesSkeleton(): React.JSX.Element {
  return (
    <View
      accessibilityLabel="Pull request changes are loading"
      accessibilityState={{ busy: true }}
      style={styles.changesSkeleton}
      testID="pull-request-changes-skeleton"
    >
      {SKELETON_ROWS.map((row, index) => (
        <View key={row} style={styles.skeletonRow}>
          <View
            style={[
              styles.skeletonPath,
              index % ALTERNATING_ROW_DIVISOR === SHORT_ROW_REMAINDER && styles.skeletonPathShort,
            ]}
          />
          <View style={styles.skeletonMeta} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  changesSkeleton: {
    flex: 1,
    paddingTop: spacing.xs,
  },
  fill: {
    flex: 1,
    minHeight: 0,
  },
  skeletonMeta: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.compact,
    height: SKELETON_META_HEIGHT,
    width: "28%",
  },
  skeletonPath: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.compact,
    height: SKELETON_PATH_HEIGHT,
    width: "64%",
  },
  skeletonPathShort: {
    width: "48%",
  },
  skeletonRow: {
    gap: spacing.xs,
    height: layoutSize.row,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
});
