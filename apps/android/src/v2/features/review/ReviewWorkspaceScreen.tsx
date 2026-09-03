import type { V2QueryResult } from "@codewide/sync-client/v2";
import { useId, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ReviewCommentStrip } from "../../presentation/review/ReviewCommentStrip";
import { ReviewFileSidebar } from "../../presentation/review/ReviewFileSidebar";
import { ReviewWorkspaceHeader } from "../../presentation/review/ReviewWorkspaceHeader";
import type {
  ReviewAnchor,
  ReviewComment,
  ReviewLineAnchor,
  ReviewScope,
  ReviewViewMode,
} from "../../rendering/review/reviewModel";
import { reviewFiles, reviewScopes } from "../../rendering/review/reviewResourceModel";
import { colors } from "../../theme";
import { V2QueryBoundary } from "../shared/V2QueryBoundary";
import { ReviewDocumentPanel } from "./ReviewDocumentPanel";
import { ReviewCommentEditor } from "./ReviewCommentEditor";
import { submitReviewFeedback } from "./reviewSubmission";
import { useReviewComments } from "./useReviewComments";

interface ReviewWorkspaceScreenProps {
  initialScope: ReviewScope;
  onClose(): void;
  owner: QualifiedThread;
}

const WIDE_REVIEW_WIDTH = 720;

export function ReviewWorkspaceScreen(props: ReviewWorkspaceScreenProps): React.JSX.Element {
  const { initialScope, onClose, owner } = props;
  const [requestedScope, setRequestedScope] = useState(initialScope);
  const commentCollection = useReviewComments();
  return (
    <V2QueryBoundary
      key={requestedScope}
      chrome="none"
      query={{
        cursor: null,
        kind: "thread.resources",
        limit: 100,
        scope: requestedScope,
        threadId: owner.threadId,
      }}
      savedServerId={owner.savedServerId}
      title="code review"
    >
      {(result, _refresh, availability) => (
        <ReviewWorkspace
          actionable={availability.actionable}
          comments={commentCollection.comments}
          onClose={onClose}
          onRemoveComment={commentCollection.remove}
          onSaveComment={commentCollection.save}
          onScopeChange={setRequestedScope}
          owner={owner}
          result={result}
        />
      )}
    </V2QueryBoundary>
  );
}

interface ReviewWorkspaceProps {
  actionable: boolean;
  comments: ReviewComment[];
  onClose(): void;
  onRemoveComment(id: string): void;
  onSaveComment(anchor: ReviewAnchor, body: string): void;
  onScopeChange(scope: ReviewScope): void;
  owner: QualifiedThread;
  result: Extract<V2QueryResult, { kind: "thread.resources" }>;
}

function ReviewWorkspace(props: ReviewWorkspaceProps): React.JSX.Element {
  const {
    actionable,
    comments,
    onClose,
    onRemoveComment,
    onSaveComment,
    onScopeChange,
    owner,
    result,
  } = props;
  const runtime = useV2Runtime();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= WIDE_REVIEW_WIDTH;
  const files = reviewFiles(result);
  const [selectedPath, setSelectedPath] = useState<string | null>(() =>
    wide ? (files[0]?.path ?? null) : null,
  );
  const [mode, setMode] = useState<ReviewViewMode>("unified");
  const [wrapLines, setWrapLines] = useState(false);
  const [selectedAnchor, setSelectedAnchor] = useState<ReviewLineAnchor | null>(null);
  const submissionSequence = useRef(0);
  const idPrefix = useId();
  const scope = result.scope;
  const scopes = reviewScopes(result, scope);
  const selectedFile = files.find((file) => file.path === selectedPath);
  const effectivePath = selectedFile?.path ?? (wide ? (files[0]?.path ?? null) : null);
  const selectPath = useEvent((path: string) => {
    setSelectedPath(path);
    setSelectedAnchor(null);
  });
  const backToFiles = useEvent(() => {
    setSelectedPath(null);
    setSelectedAnchor(null);
  });
  const saveComment = useEvent((anchor: ReviewAnchor, body: string) => {
    onSaveComment(anchor, body);
    setSelectedAnchor(null);
  });
  const clearSelectedAnchor = useEvent(() => setSelectedAnchor(null));
  const submit = useEvent(async () => {
    if (!actionable) throw new Error("Wait for the current review workspace");
    submissionSequence.current += 1;
    await submitReviewFeedback({
      attachments: runtime.composerAttachments,
      commands: runtime.commands,
      comments,
      draftId: `review:${idPrefix}:${submissionSequence.current}`,
      owner,
    });
    onClose();
  });
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ReviewWorkspaceHeader
        commentCount={comments.length}
        fileCount={files.length}
        mode={mode}
        onClose={onClose}
        onModeChange={setMode}
        onScopeChange={onScopeChange}
        onSubmit={submit}
        onWrapChange={setWrapLines}
        scope={scope}
        scopes={scopes}
        submitDisabled={!actionable}
        wrapLines={wrapLines}
      />
      <View style={styles.workspace}>
        {wide || effectivePath === null ? (
          <View style={[styles.sidebar, wide && styles.sidebarWide]}>
            <ReviewFileSidebar files={files} onSelect={selectPath} selectedPath={effectivePath} />
          </View>
        ) : null}
        {effectivePath === null ? null : (
          <ReviewDocumentPanel
            mode={mode}
            onBack={backToFiles}
            onSelectAnchor={setSelectedAnchor}
            owner={owner}
            path={effectivePath}
            scope={scope}
            selectedAnchor={selectedAnchor}
            showBack={!wide}
            wrapLines={wrapLines}
          />
        )}
      </View>
      <ReviewCommentStrip comments={comments} onRemove={onRemoveComment} />
      <View accessibilityElementsHidden style={[styles.safeBottom, { height: insets.bottom }]} />
      {selectedAnchor === null ? null : (
        <ReviewCommentEditor
          anchor={selectedAnchor}
          onCancel={clearSelectedAnchor}
          onSave={saveComment}
          owner={owner}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  safeBottom: { backgroundColor: colors.background, flexShrink: 0 },
  sidebar: { flex: 1, minWidth: 0 },
  sidebarWide: {
    borderRightColor: colors.borderSoft,
    borderRightWidth: StyleSheet.hairlineWidth,
    flex: 0,
    width: 340,
  },
  workspace: { flex: 1, flexDirection: "row", minHeight: 0 },
});
