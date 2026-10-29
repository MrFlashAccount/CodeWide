import { useState } from "react";
import { StyleSheet, View } from "react-native";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import type { DraftId } from "../../../data/reviewContract";
import { useEvent } from "../../../react/useEvent";
import { colors, layoutSize, radii, spacing } from "../../../theme";
import { useAppDialog } from "../../../ui/AppDialog";
import { AppText as Text } from "../../../ui/Typography";
import type { CodeReviewLineReference } from "../../review/comments/reviewComment";
import { CardNote } from "../overview/CardHeader";
import { overviewStyles } from "../overview/overview.styles";
import { ChangesToolbar, type ToolbarFile } from "./ChangesToolbar";
import { viewedSummary } from "./changesPresentation";
import { CommentSheetHost } from "./CommentSheetHost";
import { FilesView } from "./FilesView";
import { PullRequestGuide } from "./PullRequestGuide";
import { ReviewOutcome } from "./ReviewOutcome";
import { ReviewSubmitControl } from "./ReviewSubmitControl";
import type { PullRequestChangesProps } from "./changesContract";
import { useChangesData, type ChangesData } from "./useChangesData";
import { useDraftComposer, type DraftComposer } from "./useDraftComposer";
import { useSubmitReview } from "./useSubmitReview";

/**
 * Changes: one IDE-style toolbar over Files (tree + diff) or Guide, companion
 * drafts with their axes and the comment sheet; Submit lives in the toolbar so
 * the code keeps the screen. Files, drafts and guide are progressive
 * resources; already published data stays visible while they refresh.
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
  const { result, submit } = useSubmitReview({
    capabilities: props.capabilities,
    drafts: data.drafts,
    onStale: props.onStale,
    target: data.target,
  });
  const [width, setWidth] = useState(0);
  const besideDiff = width >= TREE_BESIDE_DIFF_MIN_WIDTH;
  // The tree opens by itself only where it leaves the diff a readable width.
  const filesOpen = data.filesPanelOpen ?? besideDiff;
  return (
    <View
      onLayout={(event) => {
        setWidth(event.nativeEvent.layout.width);
      }}
      style={styles.fill}
      testID="pull-request-changes"
    >
      {props.renderAppBar(
        data.view === "guide" ? "Review guide" : "Files changed",
        <ReviewSubmitControl
          bothTargetTitle={agentTitle}
          drafts={data.drafts}
          host={props.host}
          offline={props.offline}
          result={result}
          submit={submit}
          verdicts={props.verdicts}
        />,
      )}
      <ChangesToolbar
        file={toolbarFile(props, data)}
        filesOpen={filesOpen}
        host={props.host}
        onFiles={() => {
          if (data.view === "guide") {
            model.changesView.set("files");
          } else {
            model.filesPanelOpen.set(!filesOpen);
          }
        }}
        onRun={props.onRun}
        summary={data.page === null ? "" : viewedSummary(data.page.files)}
        tablet={props.tablet}
        view={data.view}
      />
      {result === null ? null : <ReviewOutcome host={props.host} result={result} />}
      <ChangesBody
        besideDiff={besideDiff}
        composer={composer}
        data={data}
        filesOpen={filesOpen}
        onLinePress={composer.tapLine}
        onSendToAgent={sendToAgent}
        props={props}
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

/**
 * Files or Guide over the loaded files page; a stable skeleton owns the first
 * load, and a failed first load says why with a retry.
 */
function ChangesBody({
  besideDiff,
  composer,
  data,
  filesOpen,
  onLinePress,
  onSendToAgent,
  props,
}: {
  readonly besideDiff: boolean;
  readonly composer: DraftComposer;
  readonly data: ChangesData;
  readonly filesOpen: boolean;
  readonly onLinePress: (reference: CodeReviewLineReference) => void;
  readonly onSendToAgent: (draftIds: readonly DraftId[]) => void;
  readonly props: PullRequestChangesProps;
}): React.JSX.Element {
  const { connectionId, model, overview } = props;
  const dialog = useAppDialog();
  const { filesFailure, page } = data;
  if (filesFailure !== null) {
    return (
      <View testID="pull-request-changes-failed">
        <CardNote text={filesFailure.message} />
        <Text
          accessibilityRole="button"
          onPress={filesFailure.retry}
          style={[overviewStyles.cardLine, overviewStyles.meta]}
        >
          Try again
        </Text>
      </View>
    );
  }
  if (page === null) {
    return <ChangesSkeleton />;
  }
  return (
    <>
      {data.view === "files" ? (
        <FilesView
          besideDiff={besideDiff}
          drafts={data.drafts}
          filesOpen={filesOpen}
          host={props.host}
          onCloseFiles={() => {
            model.filesPanelOpen.set(false);
          }}
          onDeleteDraft={(draft) => {
            props.reviewCapabilities.deleteDraft(connectionId, draft).catch((error: unknown) => {
              dialog.error("Could not delete the draft", error);
            });
          }}
          onGuide={() => {
            model.changesView.set("guide");
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
          onSelect={(file) => {
            model.selectedPath.set(file.path);
            if (!besideDiff) {
              // The overlay tree covers the diff; choosing a file reveals it.
              model.filesPanelOpen.set(false);
            }
          }}
          onSendToAgent={(draft) => {
            onSendToAgent([draft.id]);
          }}
          onToggleViewed={data.toggleViewed}
          page={page}
          selected={data.selected}
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

/** The selected file with its viewed toggle, actions and previous/next neighbours. */
function toolbarFile(props: PullRequestChangesProps, data: ChangesData): ToolbarFile | null {
  const { page, selected } = data;
  if (page === null || selected === null) {
    return null;
  }
  const index = page.files.indexOf(selected);
  const select = (file: PullRequestFile | undefined): (() => void) | null =>
    file === undefined
      ? null
      : () => {
          props.model.selectedPath.set(file.path);
        };
  return {
    actions: props.fileActions.get(selected.path) ?? [],
    file: selected,
    next: select(page.files[index + 1]),
    previous: select(page.files[index - 1]),
    toggleViewed: () => {
      data.toggleViewed(selected);
    },
    viewedPending: data.viewedPending.has(selected.path),
  };
}

/** Tree column (248dp) plus a diff of roughly 80 code columns. */
const TREE_BESIDE_DIFF_MIN_WIDTH = 720;
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
