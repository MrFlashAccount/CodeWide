/** V1 FileChangeProtocolBlock owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock } from "@codewide/renderers";
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
import { nextFileChangeItemKey } from "./protocolItemIdentity";
import { TOOL_RESULT_MAX_HEIGHT } from "./ToolContent";

export function FileChangeProtocolBlock({ block }: { block: RenderBlock }) {
  const changeCount = Array.isArray(block.raw.changes) ? block.raw.changes.length : 0;
  return (
    <Card
      icon="git-compare-outline"
      title={`File changes · ${String(changeCount)}`}
      {...(block.status === null ? {} : { status: block.status })}
      collapsible
      copyText={() => protocolCopyText(block)}
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
  const occurrences = new Map<string, number>();
  return (
    <>
      {changes.length === 0 ? (
        <Text style={styles.menuNotice}>No structured file changes were returned.</Text>
      ) : (
        changes.map((change, index) => {
          const diff = typeof change.diff === "string" ? change.diff : "";
          const path = typeof change.path === "string" ? change.path : `File ${String(index + 1)}`;
          const key = nextFileChangeItemKey(occurrences, path);
          return <DiffFile diff={diff} key={key} kind={change.kind} path={path} />;
        })
      )}
    </>
  );
}

export function DiffFile({ diff, kind, path }: { diff: string; kind: unknown; path: string }) {
  const cwd = useContext(ThreadCwdContext);
  const [expanded, setExpanded] = usePersistentExpansion(`diff:${path}`, false);
  const projection = projectFileChange(diff, kind);
  const { additions, deletions } = projection;
  const displayPath = changedFileDisplayPath(path, cwd);
  return (
    <View style={styles.diffFile}>
      <Pressable
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} diff ${path}`}
        accessibilityRole="button"
        onPress={() => {
          setExpanded((value) => !value);
        }}
        style={styles.diffFileHeader}
      >
        <InlineIcon
          color={colors.textMuted}
          name={expanded ? "chevron-down" : "chevron-forward"}
          role="label"
        />
        <Text ellipsizeMode="middle" numberOfLines={1} style={styles.diffFilePath}>
          {displayPath}
        </Text>
        <Text numberOfLines={1} style={styles.diffKind}>
          {projection.kind}
        </Text>
        <Text style={[styles.diffStat, styles.diffStatAdd]}>+{additions}</Text>
        <Text style={[styles.diffStat, styles.diffStatDelete]}>−{deletions}</Text>
        <CopyButton compact text={diff} />
      </Pressable>
      {expanded && (
        <View style={styles.diffLines}>
          <NativeCodeBlock
            fillAvailableWidth
            language={nativeCodeLanguageForPath(path)}
            maxHeight={TOOL_RESULT_MAX_HEIGHT}
            value={projection.renderSource}
            variant="diff"
          />
        </View>
      )}
    </View>
  );
}
