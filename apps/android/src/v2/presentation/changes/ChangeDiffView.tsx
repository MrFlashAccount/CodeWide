import type { V2QueryResult, V2ThreadChangePatch } from "@codewide/sync-client/v2";
import { ScrollView, StyleSheet, View, type TextStyle } from "react-native";

import { colors, radii, spacing, typeScale, typeWeight } from "../../theme";
import { ActionButtonView } from "../actions/ActionButtonView";
import { ProductText as Text } from "../text/ProductText";

type ThreadChangeResult = Extract<V2QueryResult, { kind: "thread.change" }>;

interface ChangeDiffViewProps {
  onOpenFullDiff(): void;
  result: ThreadChangeResult;
}

interface DiffBlockProps {
  index: number;
  patch: V2ThreadChangePatch;
}

export function ChangeDiffView(props: ChangeDiffViewProps): React.JSX.Element {
  const { onOpenFullDiff, result } = props;
  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.root}>
      {result.patches.map((patch, index) => (
        <DiffBlock
          key={`${patch.turnId}:${patch.itemId}:${patch.kind}`}
          index={index}
          patch={patch}
        />
      ))}
      {result.patches.length === 0 && result.source !== null ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Current source</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <Text selectable style={styles.code}>
              {result.source}
            </Text>
          </ScrollView>
        </View>
      ) : null}
      {result.patches.length === 0 && result.source === null ? (
        <View style={styles.empty}>
          <Text style={styles.notice}>No detailed diff is available for this change.</Text>
        </View>
      ) : null}
      {result.truncated ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>This diff was truncated by the server.</Text>
          <ActionButtonView
            disabled={false}
            label="Open full diff"
            onPress={onOpenFullDiff}
            pending={false}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

function DiffBlock(props: DiffBlockProps): React.JSX.Element {
  const { index, patch } = props;
  return (
    <View style={styles.block}>
      <Text style={[styles.blockTitle, patchTitleStyle(patch.kind)]}>
        {patch.kind} · change {index + 1}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <Text selectable style={styles.code}>
          {patch.diff}
        </Text>
      </ScrollView>
    </View>
  );
}

function patchTitleStyle(kind: V2ThreadChangePatch["kind"]): TextStyle {
  if (kind === "add") return styles.added;
  if (kind === "delete") return styles.deleted;
  return styles.updated;
}

const styles = StyleSheet.create({
  added: { color: colors.green },
  block: {
    backgroundColor: colors.code,
    borderColor: colors.borderSoft,
    borderRadius: radii.selected,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  blockTitle: {
    backgroundColor: colors.surface,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    textTransform: "capitalize",
    ...typeScale.label,
    fontWeight: typeWeight.medium,
  },
  code: { color: colors.text, padding: spacing.md, ...typeScale.code },
  content: { gap: spacing.sm, padding: spacing.md },
  deleted: { color: colors.red },
  empty: { alignItems: "center", justifyContent: "center", minHeight: 180 },
  notice: { color: colors.textMuted, ...typeScale.body },
  root: { flex: 1 },
  updated: { color: colors.textMuted },
  warning: {
    backgroundColor: colors.surface,
    borderRadius: radii.selected,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  warningText: { color: colors.textMuted, ...typeScale.label },
});
