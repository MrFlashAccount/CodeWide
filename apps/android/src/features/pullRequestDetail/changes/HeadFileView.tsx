import { StyleSheet, View } from "react-native";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { useForgeQuery } from "../../../data/forgeQueryResource";
import { remoteValue } from "../../../data/forgeRemoteValue";
import { colors, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { CodeReviewEditor } from "../../review/editor/CodeReviewEditor";
import type { DiffDisplay } from "./diffDisplay";
import type { HeadFileSource } from "./headFileViews";

/** Read-only whole file at the reviewed revision. A missing or binary blob has its own empty state. */
export function HeadFileView({
  display,
  file,
  source,
}: {
  readonly display: DiffDisplay;
  readonly file: PullRequestFile;
  readonly source: HeadFileSource;
}): React.JSX.Element {
  const snapshot = useForgeQuery(source.resource, { ...source.target, path: file.path });
  const blob = remoteValue(snapshot);
  const error = snapshot.status === "failed" ? snapshot.failure.message : null;
  if (blob !== null && blob.state !== "text") {
    return <Text style={styles.note}>{unavailable[blob.state]}</Text>;
  }
  const document =
    blob === null
      ? null
      : {
          patches: [],
          path: file.path,
          revision: `${source.target.headRevision}:${file.path}`,
          source: blob.content,
        };
  return (
    <View style={styles.fill}>
      <Text numberOfLines={2} style={styles.note}>
        {file.path}
      </Text>
      <CodeReviewEditor
        comments={[]}
        compact
        document={document}
        files={[]}
        loadError={error}
        loading={blob === null && error === null}
        mode="source"
        onFileSelect={ignore}
        onLinePress={ignore}
        revealReference={null}
        selectedPath={file.path}
        selectedReference={null}
        showLineNumbers={display.showNumbers}
        sidebarOpen={false}
        workspaceRevision={source.target.headRevision}
        wrapLines={display.wrapLines}
      />
    </View>
  );
}

const unavailable = {
  binary: "Binary file",
  missing: "File is unavailable at this revision",
  tooLarge: "File is too large to display",
} as const;
function ignore(): void {}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 0,
  },
  note: {
    ...typeScale.body,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
