import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { colors, controlHitSlop, iconSize, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { viewedLabel } from "./changesPresentation";

/** The viewed mark of one file; toggling it is an explicit forge write. */
export function ViewedToggle({
  file,
  host,
  onToggle,
  pending,
}: {
  readonly file: PullRequestFile;
  readonly host: string;
  readonly onToggle: () => void;
  readonly pending: boolean;
}): React.JSX.Element {
  const { viewed } = file.viewed;
  return (
    <Pressable
      accessibilityLabel={viewed ? `${viewedLabel(file, host)}. Mark not viewed` : "Mark viewed"}
      accessibilityRole="checkbox"
      accessibilityState={{ busy: pending, checked: viewed }}
      disabled={pending}
      hitSlop={controlHitSlop.compact}
      onPress={onToggle}
    >
      <Ionicons
        color={viewed ? colors.success : colors.textMuted}
        name={viewed ? "checkbox" : "square-outline"}
        size={iconSize.inline}
      />
    </Pressable>
  );
}

/** `+12 −3`, omitting a zero side. */
export function DiffCounts({ file }: { readonly file: PullRequestFile }): React.JSX.Element {
  return (
    <Text style={styles.counts}>
      {file.additions > 0 ? <Text style={styles.added}>{`+${String(file.additions)}`}</Text> : null}
      {file.additions > 0 && file.deletions > 0 ? " " : null}
      {file.deletions > 0 ? (
        <Text style={styles.removed}>{`−${String(file.deletions)}`}</Text>
      ) : null}
    </Text>
  );
}

const styles = StyleSheet.create({
  added: {
    color: colors.success,
  },
  counts: {
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
  },
  removed: {
    color: colors.error,
  },
});
