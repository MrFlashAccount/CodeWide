import { ScrollView, StyleSheet, View } from "react-native";

import { colors, radii, spacing } from "../../theme";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";

export type TimelineDisplayRow =
  | { id: string; kind: "assistant"; text: string }
  | { detail?: string; id: string; kind: "activity"; label: string; state?: string }
  | { id: string; kind: "lifecycle"; label: string }
  | { id: string; kind: "status"; state: string }
  | { id: string; kind: "user"; text: string };

interface TimelineViewProps {
  rows: TimelineDisplayRow[];
}

interface TimelineRowProps {
  row: TimelineDisplayRow;
}

export function TimelineView({ rows }: TimelineViewProps): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <PresentationIcon color={colors.textDim} name="sparkles" size={26} />
        <ProductText style={styles.emptyTitle} weight="semibold">
          Start by typing a message
        </ProductText>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.list} style={styles.scroll}>
      {rows.map((row) => (
        <TimelineRow key={row.id} row={row} />
      ))}
    </ScrollView>
  );
}

function TimelineRow({ row }: TimelineRowProps): React.JSX.Element {
  if (row.kind === "user") {
    return (
      <View style={styles.userBubble}>
        <ProductText selectable style={styles.messageText}>
          {row.text}
        </ProductText>
      </View>
    );
  }
  if (row.kind === "assistant") {
    return (
      <View style={styles.assistantBubble}>
        <ProductText selectable style={styles.messageText}>
          {row.text}
        </ProductText>
      </View>
    );
  }
  if (row.kind === "lifecycle") {
    return (
      <View style={styles.lifecycle}>
        <PresentationIcon color={colors.textMuted} name="sparkles" size={15} />
        <ProductText numberOfLines={2} style={styles.lifecycleText} tone="muted" weight="semibold">
          {row.label}
        </ProductText>
      </View>
    );
  }
  if (row.kind === "status") {
    return (
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, statusDotStyle(row.state)]} />
        <ProductText style={styles.statusText} tone="muted">
          {turnStateLabel(row.state)}
        </ProductText>
      </View>
    );
  }
  return (
    <View style={styles.activityCard}>
      <View style={styles.activityTitleRow}>
        <PresentationIcon color={colors.textMuted} name={activityIcon(row.label)} size={16} />
        <ProductText style={styles.activityTitle} tone="muted" weight="semibold">
          {row.label}
        </ProductText>
        {row.state === undefined ? null : (
          <ProductText style={styles.activityState} tone="dim">
            {row.state}
          </ProductText>
        )}
      </View>
      {row.detail === undefined || row.detail === "" ? null : (
        <ProductText selectable style={styles.activityDetail} tone="muted">
          {row.detail}
        </ProductText>
      )}
    </View>
  );
}

function activityIcon(label: string): PresentationIconName {
  if (label === "Command") return "terminal";
  if (label === "Changes") return "changes";
  if (label === "Plan") return "list";
  if (label === "Attachment") return "attach";
  return "construct";
}

function statusDotStyle(state: string): { backgroundColor: string } {
  if (state === "running" || state === "queued") return { backgroundColor: colors.amber };
  if (state === "failed") return { backgroundColor: colors.red };
  if (state === "completed") return { backgroundColor: colors.green };
  return { backgroundColor: colors.textDim };
}

function turnStateLabel(state: string): string {
  if (state === "running") return "Running";
  if (state === "queued") return "Queued";
  if (state === "completed") return "Completed";
  if (state === "failed") return "Failed";
  return "Interrupted";
}

const styles = StyleSheet.create({
  activityCard: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderRadius: radii.selected,
    gap: 7,
    maxWidth: "88%",
    paddingBottom: 10,
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  activityDetail: { fontSize: 12, lineHeight: 17 },
  activityState: { fontSize: 11, marginLeft: "auto" },
  activityTitle: { fontSize: 12, lineHeight: 17 },
  activityTitleRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderRadius: radii.selected,
    maxWidth: "88%",
    paddingBottom: 8,
    paddingHorizontal: 10,
    paddingTop: 7,
  },
  empty: { alignItems: "center", flex: 1, gap: spacing.sm, justifyContent: "center" },
  emptyTitle: { fontSize: 16, lineHeight: 22 },
  lifecycle: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    gap: 7,
    minHeight: 28,
    paddingHorizontal: spacing.xs,
  },
  lifecycleText: { flexShrink: 1, fontSize: 12, lineHeight: 17 },
  list: {
    flexGrow: 1,
    gap: 5,
    justifyContent: "flex-end",
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingTop: 6,
  },
  messageText: { fontSize: 13, lineHeight: 18 },
  scroll: { flex: 1 },
  statusDot: { borderRadius: 4, height: 7, width: 7 },
  statusRow: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 6,
    minHeight: 24,
    paddingHorizontal: 5,
  },
  statusText: { fontSize: 11, lineHeight: 15 },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.selected,
    maxWidth: "82%",
    paddingBottom: 9,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
});
