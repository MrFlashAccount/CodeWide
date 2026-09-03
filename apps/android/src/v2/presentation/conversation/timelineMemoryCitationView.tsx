import { StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";
import type { TimelineMemoryCitation, TimelineMemoryCitationEntry } from "./timelineTypes";

interface TimelineMemoryCitationViewProps {
  citations: TimelineMemoryCitation[];
}

interface CitationEntryViewProps {
  entry: TimelineMemoryCitationEntry;
}

interface CitationEntry {
  entry: TimelineMemoryCitationEntry;
  key: string;
}

export function TimelineMemoryCitationView(
  props: TimelineMemoryCitationViewProps,
): React.JSX.Element | null {
  const { citations } = props;
  const entries = citationEntries(citations);
  const threadIds = [...new Set(citations.flatMap((citation) => citation.threadIds))];
  if (entries.length === 0 && threadIds.length === 0) return null;
  return (
    <View style={styles.container} testID="memory-citations">
      <ProductText tone="muted" weight="semibold">
        {`Sources · ${String(entries.length)}`}
      </ProductText>
      {entries.map((entry) => (
        <CitationEntryView entry={entry.entry} key={entry.key} />
      ))}
      {threadIds.length === 0 ? null : (
        <ProductText selectable style={styles.threadIds} tone="dim">
          {`Source threads · ${threadIds.join(", ")}`}
        </ProductText>
      )}
    </View>
  );
}

function CitationEntryView(props: CitationEntryViewProps): React.JSX.Element {
  const { entry } = props;
  const lines =
    entry.lineStart === entry.lineEnd
      ? `:${String(entry.lineStart)}`
      : `:${String(entry.lineStart)}–${String(entry.lineEnd)}`;
  return (
    <View style={styles.entry}>
      <ProductText ellipsizeMode="middle" numberOfLines={1} selectable style={styles.path}>
        {`${entry.path}${lines}`}
      </ProductText>
      {entry.note === "" ? null : (
        <ProductText selectable tone="muted">
          {entry.note}
        </ProductText>
      )}
    </View>
  );
}

function citationEntries(citations: TimelineMemoryCitation[]): CitationEntry[] {
  const occurrences = new Map<string, number>();
  return citations.flatMap((citation) =>
    citation.entries.map((entry) => {
      const identity = `${entry.path}:${String(entry.lineStart)}:${String(entry.lineEnd)}:${entry.note}`;
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      return { entry, key: `${identity}:${String(occurrence)}` };
    }),
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs, marginTop: spacing.xs },
  entry: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.small,
    gap: spacing.optical,
    padding: spacing.xs,
  },
  path: { color: colors.accent, ...typeScale.caption },
  threadIds: { ...typeScale.caption },
});
