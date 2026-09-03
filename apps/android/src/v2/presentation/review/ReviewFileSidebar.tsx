import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, typeScale } from "../../theme";
import type { ReviewFile } from "../../rendering/review/reviewModel";
import { ProductText } from "../text/ProductText";

interface ReviewFileSidebarProps {
  files: ReviewFile[];
  onSelect(path: string): void;
  selectedPath: string | null;
}

interface ReviewFileRowProps {
  file: ReviewFile;
  onSelect(path: string): void;
  selected: boolean;
}

export function ReviewFileSidebar(props: ReviewFileSidebarProps): React.JSX.Element {
  const { files, onSelect, selectedPath } = props;
  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.root}>
      {files.map((file) => (
        <ReviewFileRow
          key={file.path}
          file={file}
          onSelect={onSelect}
          selected={file.path === selectedPath}
        />
      ))}
      {files.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons color={colors.textDim} name="git-compare-outline" size={28} />
          <ProductText tone="muted">No file changes in this scope.</ProductText>
        </View>
      ) : null}
    </ScrollView>
  );
}

function ReviewFileRow(props: ReviewFileRowProps): React.JSX.Element {
  const { file, onSelect, selected } = props;
  const select = useEvent(() => onSelect(file.path));
  return (
    <Pressable
      accessibilityLabel={`Review ${file.path}`}
      onPress={select}
      style={[styles.row, selected && styles.selected]}
    >
      <Ionicons color={fileColor(file)} name={fileIcon(file)} size={19} />
      <View style={styles.copy}>
        <ProductText ellipsizeMode="middle" numberOfLines={1}>
          {file.path}
        </ProductText>
        <ProductText style={styles.kind} tone="dim">
          {file.kind}
        </ProductText>
      </View>
      <ProductText style={styles.additions}>+{file.additions}</ProductText>
      <ProductText style={styles.deletions}>−{file.deletions}</ProductText>
    </Pressable>
  );
}

function fileIcon(file: ReviewFile): keyof typeof Ionicons.glyphMap {
  if (file.kind === "add") return "add-circle-outline";
  if (file.kind === "delete") return "remove-circle-outline";
  return "document-text-outline";
}

function fileColor(file: ReviewFile): string {
  if (file.kind === "add") return colors.green;
  if (file.kind === "delete") return colors.red;
  return colors.textMuted;
}

const styles = StyleSheet.create({
  additions: { color: colors.green, ...typeScale.label },
  content: { gap: spacing.optical, padding: spacing.sm, paddingBottom: spacing.xl },
  copy: { flex: 1, minWidth: 0 },
  deletions: { color: colors.red, ...typeScale.label },
  empty: { alignItems: "center", gap: spacing.sm, justifyContent: "center", minHeight: 180 },
  kind: { textTransform: "capitalize", ...typeScale.caption },
  root: { backgroundColor: colors.surface, flex: 1 },
  row: {
    alignItems: "center",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  selected: { backgroundColor: colors.surfaceHover },
});
