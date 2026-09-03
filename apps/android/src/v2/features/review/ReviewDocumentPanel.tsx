import type { V2QueryResult } from "@codewide/sync-client/v2";
import { StyleSheet, View } from "react-native";

import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ReviewDiffView } from "../../presentation/review/ReviewDiffView";
import { ReviewDocumentHeader } from "../../presentation/review/ReviewDocumentHeader";
import {
  reviewDiffLines,
  reviewSourceLines,
  reviewSplitLines,
} from "../../rendering/review/reviewDiffModel";
import type {
  ReviewLineAnchor,
  ReviewScope,
  ReviewViewMode,
} from "../../rendering/review/reviewModel";
import { V2QueryBoundary } from "../shared/V2QueryBoundary";

interface ReviewDocumentPanelProps {
  mode: ReviewViewMode;
  onBack(): void;
  onSelectAnchor(anchor: ReviewLineAnchor): void;
  owner: QualifiedThread;
  path: string;
  scope: ReviewScope;
  selectedAnchor: ReviewLineAnchor | null;
  showBack: boolean;
  wrapLines: boolean;
}

export function ReviewDocumentPanel(props: ReviewDocumentPanelProps): React.JSX.Element {
  const { mode, onBack, onSelectAnchor, owner, path, scope, selectedAnchor, showBack, wrapLines } =
    props;
  return (
    <View style={styles.root}>
      <ReviewDocumentHeader onBack={onBack} path={path} showBack={showBack} />
      <V2QueryBoundary
        key={`${scope}:${path}`}
        chrome="none"
        query={{ kind: "thread.change", path, scope, threadId: owner.threadId }}
        savedServerId={owner.savedServerId}
        title="review diff"
      >
        {(result) => (
          <LoadedReviewDocument
            mode={mode}
            onSelectAnchor={onSelectAnchor}
            path={path}
            result={result}
            selectedAnchor={selectedAnchor}
            wrapLines={wrapLines}
          />
        )}
      </V2QueryBoundary>
    </View>
  );
}

interface LoadedReviewDocumentProps {
  mode: ReviewViewMode;
  onSelectAnchor(anchor: ReviewLineAnchor): void;
  path: string;
  result: Extract<V2QueryResult, { kind: "thread.change" }>;
  selectedAnchor: ReviewLineAnchor | null;
  wrapLines: boolean;
}

function LoadedReviewDocument(props: LoadedReviewDocumentProps): React.JSX.Element {
  const { mode, onSelectAnchor, path, result, selectedAnchor, wrapLines } = props;
  const diffLines = reviewDiffLines(path, result.patches);
  const sourceLines = result.source !== null ? reviewSourceLines(path, result.source) : [];
  const lines = mode === "source" && sourceLines.length > 0 ? sourceLines : diffLines;
  const splitLines = reviewSplitLines(lines);
  return (
    <ReviewDiffView
      lines={lines}
      mode={mode}
      onSelectAnchor={onSelectAnchor}
      selectedAnchor={selectedAnchor}
      splitLines={splitLines}
      truncated={result.truncated}
      wrapLines={wrapLines}
    />
  );
}

const styles = StyleSheet.create({ root: { flex: 1, minWidth: 0 } });
