import { StyleSheet, View } from "react-native";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { colors, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import type {
  CodeReviewComment,
  CodeReviewLineReference,
} from "../../review/comments/reviewComment";
import { CodeReviewEditor } from "../../review/editor/CodeReviewEditor";
import {
  codeReviewWorkspaceRevision,
  type CodeReviewFileItem,
} from "../../review/editor/editorBridge";
import { fileDocument } from "./changesPresentation";

const BYTES_PER_MEGABYTE = 1_048_576;
/** Keeps a short diff usable when the drafts list below it is long. */
const MIN_DIFF_HEIGHT = 160;

/**
 * One PR file in the Pierre review editor, in recorded-patch mode. Drafts show
 * inline; a line tap opens the comment sheet instead of an inline composer.
 * Files without a patch say why in place.
 */
export function PullRequestDiff({
  comments,
  file,
  onLinePress,
  reveal,
}: {
  readonly comments: readonly CodeReviewComment[];
  readonly file: PullRequestFile;
  readonly onLinePress: (reference: CodeReviewLineReference) => void;
  readonly reveal: CodeReviewLineReference | null;
}): React.JSX.Element {
  const document = fileDocument(file);
  if (document === null) {
    return (
      <View style={styles.unavailable}>
        <Text style={styles.text}>
          {file.patch.state === "tooLarge"
            ? `Too large to render${file.patch.bytes === null ? "" : ` (${String(Math.ceil(file.patch.bytes / BYTES_PER_MEGABYTE))} MB)`}`
            : file.patch.state === "binary"
              ? "Binary file"
              : "No patch provided by the forge"}
        </Text>
      </View>
    );
  }
  const item: CodeReviewFileItem = {
    additions: file.additions,
    deletions: file.deletions,
    path: file.path,
    status: file.status === "added" ? "added" : file.status === "removed" ? "deleted" : "modified",
    treePath: file.path,
  };
  return (
    <View style={styles.editor} testID="pull-request-diff">
      <CodeReviewEditor
        commentDraft=""
        comments={comments}
        compact
        document={document}
        files={[item]}
        loadError={null}
        loading={false}
        mode="unified"
        onCommentDraftChange={() => undefined}
        onCommentSelectionChange={() => undefined}
        onCommentSubmit={() => undefined}
        onFileSelect={() => undefined}
        onLinePress={onLinePress}
        onVoicePress={() => undefined}
        revealReference={reveal}
        selectedPath={file.path}
        selectedReference={null}
        sidebarOpen={false}
        voiceError={null}
        voicePermissionGranted={false}
        voicePhase="idle"
        voiceRetryAvailable={false}
        workspaceRevision={codeReviewWorkspaceRevision([item])}
        wrapLines={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  editor: {
    flex: 1,
    minHeight: MIN_DIFF_HEIGHT,
  },
  text: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  unavailable: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
});
