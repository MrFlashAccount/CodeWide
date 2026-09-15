/** V1 FileChangeProtocolBlock owner, extracted without changing interaction or resource lifetime. */
import { type RenderBlock } from "@codewide/renderers";
import { useContext } from "react";
import { Pressable, View } from "react-native";
import { changedFileDisplayPath } from "../../../rendering/changed-file-path";
import { projectFileChange } from "../../../rendering/file-change-rendering";
import { nativeCodeLanguageForPath } from "../../../rendering/native-code-block";
import { NativeCodeBlock } from "../../../rendering/NativeCodeBlock";
import { colors } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { Card, usePersistentExpansion } from "../turns/Card";
import { CopyButton } from "../turns/MessageActionRail";
import { ThreadCwdContext } from "../turns/turnContexts";
import { styles } from "./FileChangeProtocolBlock.styles";
import { protocolCopyText } from "./protocolCopyText";
import { TOOL_RESULT_MAX_HEIGHT } from "./ToolContent";

export function FileChangeProtocolBlock({ block }: { block: RenderBlock }) {
  const changeCount = Array.isArray(block.raw.changes) ? block.raw.changes.length : 0;
  return (
    <Card
      title={`File changes · ${changeCount}`}
      icon="git-compare-outline"
      {...(block.status === null ? {} : { status: block.status })}
      copyText={() => protocolCopyText(block)}
      collapsible
      initiallyExpanded={false}
    >
      <FileChangeProtocolDetails block={block} />
    </Card>
  );
}

export function FileChangeProtocolDetails({ block }: { block: RenderBlock }) {
  const changes = Array.isArray(block.raw.changes)
    ? block.raw.changes.filter(
        (change): change is Record<string, unknown> =>
          change !== null && typeof change === "object" && !Array.isArray(change),
      )
    : [];
  return (
    <>
      {changes.length === 0 ? (
        <Text style={styles.menuNotice}>No structured file changes were returned.</Text>
      ) : (
        changes.map((change, index) => (
          <DiffFile
            key={`${String(change.path ?? "file")}-${index}`}
            path={typeof change.path === "string" ? change.path : `File ${index + 1}`}
            kind={change.kind}
            diff={typeof change.diff === "string" ? change.diff : ""}
          />
        ))
      )}
    </>
  );
}

export function DiffFile({ path, kind, diff }: { path: string; kind: unknown; diff: string }) {
  const cwd = useContext(ThreadCwdContext);
  const [expanded, setExpanded] = usePersistentExpansion(`diff:${path}`, false);
  const projection = projectFileChange(diff, kind);
  const { additions, deletions } = projection;
  const displayPath = changedFileDisplayPath(path, cwd);
  return (
    <View style={styles.diffFile}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} diff ${path}`}
        onPress={() => setExpanded((value) => !value)}
        style={styles.diffFileHeader}
      >
        <InlineIcon
          name={expanded ? "chevron-down" : "chevron-forward"}
          role="label"
          color={colors.textMuted}
        />
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.diffFilePath}>
          {displayPath}
        </Text>
        <Text numberOfLines={1} style={styles.diffKind}>
          {projection.kind}
        </Text>
        <Text style={[styles.diffStat, styles.diffStatAdd]}>+{additions}</Text>
        <Text style={[styles.diffStat, styles.diffStatDelete]}>−{deletions}</Text>
        <CopyButton text={diff} compact />
      </Pressable>
      {expanded && (
        <View style={styles.diffLines}>
          <NativeCodeBlock
            value={projection.renderSource}
            language={nativeCodeLanguageForPath(path)}
            variant="diff"
            maxHeight={TOOL_RESULT_MAX_HEIGHT}
            fillAvailableWidth
          />
        </View>
      )}
    </View>
  );
}
