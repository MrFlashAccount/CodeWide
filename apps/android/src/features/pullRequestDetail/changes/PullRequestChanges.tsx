import { useSelector } from "@legendapp/state/react";

import { PaneBody } from "../../../ui/PaneBody";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { useAndroidBackHandler } from "../../../ui/use-android-back-handler";
import type { DraftPut } from "../../../data/reviewDraftPuts";
import { FileCommentForm } from "./FileCommentForm";
import { HeadFileView } from "./HeadFileView";
import { ChangesHeaderActions } from "./ChangesHeaderActions";
import { useDiffDisplay, type DiffDisplay } from "./diffDisplay";
import type { DraftId } from "../../../data/reviewContract";
import { useEvent } from "../../../react/useEvent";
import { colors, layoutSize, radii, spacing } from "../../../theme";
import { useAppDialog } from "../../../ui/AppDialog";
import { AppText as Text } from "../../../ui/Typography";
import { LineCommentFrame } from "../../review/comments/LineCommentFrame";
import type { CodeReviewLineReference } from "../../review/comments/reviewComment";
import { CardNote } from "../overview/CardHeader";
import { overviewStyles } from "../overview/overview.styles";
import { ChangesToolbar } from "./ChangesToolbar";
import { FilesView } from "./FilesView";
import { PullRequestGuide } from "./PullRequestGuide";
import { ReviewOutcome } from "./ReviewOutcome";
import { ReviewSubmitControl } from "./ReviewSubmitControl";
import type { PullRequestChangesProps } from "./changesContract";
import {
  useFileMenu,
  useFileReading,
  useFileComment,
  canFloat,
  acceptReadingBack,
} from "./fileReading";
import { useChangesData, type ChangesData } from "./useChangesData";
import { useDraftComposer, type DraftComposer } from "./useDraftComposer";
import { useSubmitReview } from "./useSubmitReview";

/**
 * Changes: one IDE-style toolbar over Files (tree + diff) or Guide, companion
 * drafts with their axes and the one line composer docked under the diff above
 * the keyboard. Review floats beside chat while reading. Files, drafts and guide are
 * progressive resources; already published data stays visible while they
 * refresh, and a new draft shows the moment it is sent.
 */
export function PullRequestChanges(props: PullRequestChangesProps): React.JSX.Element {
  const { connectionId, model, overview } = props;
  const dialog = useAppDialog();
  const [width, setWidth] = useState(0);
  const besideDiff = width >= TREE_BESIDE_DIFF_MIN_WIDTH;
  // The tree opens by itself only where it leaves the diff a readable width.
  const [pickerOpen, setPickerOpen] = useState(false);
  const sidebar = useSelector(() => model.filesPanelOpen.get());
  const filesOpen = isFileListOpen(besideDiff, sidebar, pickerOpen);
  const data = useChangesData(props, filesOpen);
  const display = useDiffDisplay();
  const composer = useDraftComposer({
    capabilities: props.reviewCapabilities,
    connectionId,
    files: data.files,
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
  const { result, submit } = useSubmitReview({
    capabilities: props.capabilities,
    drafts: data.drafts,
    onStale: props.onStale,
    target: data.target,
  });
  const setFilesOpen = useEvent((open: boolean) => {
    if (besideDiff) {
      model.filesPanelOpen.set(open);
    } else {
      setPickerOpen(open);
    }
  });
  const { closeFileComment, commentOnFile, fileComment, onLinePress, restorePut } = useFileComment(
    props,
    data,
    composer,
  );
  const reading = useFileReading(props, data);
  useAndroidBackHandler(
    acceptReadingBack(reading.back, composer, fileComment),
    reading.backToFiles,
  );
  const fileMenu = useFileMenu({ commentOnFile, data, props, viewSource: reading.viewSource });
  const floating = canFloat({
    comment: fileComment,
    line: composer.line,
    pickerOpen,
    source: reading.sourceFile,
  });
  const reviewControl = (
    <ReviewSubmitControl
      bothTargetTitle={data.agentTitle}
      drafts={data.drafts}
      host={props.host}
      offline={props.offline}
      result={result}
      submit={submit}
      verdicts={props.verdicts}
    />
  );
  return (
    <View
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next >= TREE_BESIDE_DIFF_MIN_WIDTH) {
          setPickerOpen(false);
        }
        setWidth(next);
      }}
      style={styles.fill}
      testID="pull-request-changes"
    >
      <LineCommentFrame composer={lineFrame(composer, props.voiceRuntime)}>
        {props.renderAppBar(
          reading.title,
          <ChangesHeaderActions
            data={data}
            display={display.value}
            onSelect={display.select}
            screen={props}
          />,
          reading.back,
        )}
        {reading.files ? (
          <ChangesToolbar
            actions={reading.actions}
            extra={fileMenu}
            file={data.selected}
            filesOpen={filesOpen}
            onFiles={() => {
              setFilesOpen(!filesOpen);
            }}
            onRun={props.onRun}
            scrollPath={display.value.scrollPath}
            tablet={besideDiff}
          />
        ) : null}
        {result === null ? null : <ReviewOutcome host={props.host} result={result} />}
        {reading.sourceFile === null ? (
          <ChangesBody
            besideDiff={besideDiff}
            composer={composer}
            data={data}
            display={display.value}
            filesOpen={filesOpen}
            onLinePress={onLinePress}
            onSendToAgent={sendToAgent}
            props={props}
            restorePut={restorePut}
            setFilesOpen={setFilesOpen}
          />
        ) : (
          <HeadFileView display={display.value} file={reading.sourceFile} source={data.headFiles} />
        )}
      </LineCommentFrame>
      {fileComment !== null && (
        <FileCommentForm
          close={closeFileComment}
          key={fileComment.path}
          screen={props}
          target={fileComment}
        />
      )}
      {floating ? props.floatingActions(reviewControl) : null}
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
  display,
  filesOpen,
  onLinePress,
  onSendToAgent,
  props,
  restorePut,
  setFilesOpen,
}: {
  readonly besideDiff: boolean;
  readonly composer: DraftComposer;
  readonly data: ChangesData;
  readonly display: DiffDisplay;
  readonly filesOpen: boolean;
  readonly onLinePress: (reference: CodeReviewLineReference) => void;
  readonly onSendToAgent: (draftIds: readonly DraftId[]) => void;
  readonly props: PullRequestChangesProps;
  readonly restorePut: (put: DraftPut) => void;
  readonly setFilesOpen: (open: boolean) => void;
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
    <PaneBody>
      {data.view === "files" ? (
        <FilesView
          besideDiff={besideDiff}
          composerLine={composer.line}
          display={display}
          draftPuts={data.draftPuts}
          drafts={data.drafts}
          filesOpen={filesOpen}
          headFiles={data.headFiles}
          host={props.host}
          onDeleteDraft={(draft) => {
            props.reviewCapabilities.deleteDraft(connectionId, draft).catch((error: unknown) => {
              dialog.error("Could not delete the draft", error);
            });
          }}
          onDiscardPut={composer.discard}
          onEditDraft={composer.edit}
          onEditPut={restorePut}
          onFilesOpenChange={setFilesOpen}
          onLinePress={onLinePress}
          onReanchor={composer.startReanchor}
          onSelect={(path) => {
            model.selectedPath.set(path);
            if (!besideDiff) {
              // The narrow tree takes the diff's place; choosing a file reveals it.
              setFilesOpen(false);
            }
          }}
          onSendToAgent={(draft) => {
            onSendToAgent([draft.id]);
          }}
          page={page}
          selected={data.selected}
          treeFailure={data.treeFailure}
        />
      ) : null}
      {data.view === "guide" ? (
        <PullRequestGuide
          agentThread={props.agentThread}
          capabilities={props.reviewCapabilities}
          composerLine={composer.line}
          connectionId={connectionId}
          describeThread={props.describeThread}
          display={display}
          draftPuts={data.draftPuts}
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
    </PaneBody>
  );
}

function lineFrame(composer: DraftComposer, voice: PullRequestChangesProps["voiceRuntime"]) {
  return composer.line === null
    ? null
    : {
        drafts: composer.drafts,
        onClose: composer.close,
        onSubmit: composer.add,
        submitLabel: composer.editing ? "Save comment" : "Add to review",
        target: composer.line,
        voice: voice,
      };
}

/** Tree column (248dp) plus a diff of roughly 80 code columns. */
const TREE_BESIDE_DIFF_MIN_WIDTH = 620;
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

function isFileListOpen(wide: boolean, sidebar: boolean | null, sheet: boolean): boolean {
  return wide ? (sidebar ?? true) : sheet;
}
