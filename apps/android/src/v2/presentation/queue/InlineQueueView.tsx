import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import type { QueueRowModel } from "./queueTypes";

export interface InlineQueueViewProps {
  hasMore?: boolean;
  items: QueueRowModel[];
  onOpen(): void;
}

interface InlineQueueSummaryProps {
  item: QueueRowModel;
}

export function InlineQueueView(props: InlineQueueViewProps): React.JSX.Element | null {
  const { hasMore = false, items, onOpen } = props;
  const first = items[0];
  if (first === undefined && !hasMore) return null;
  const second = items[1];
  return (
    <Pressable
      accessibilityLabel={`Open queued prompts, ${queueAccessibilityCount(items.length, hasMore)}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={rootStyle}
      testID="v2-inline-queue"
    >
      <View style={styles.header}>
        <PresentationIcon color={statusColor(items)} name="list" size={18} />
        <ProductText numberOfLines={1} style={styles.title}>
          {queueCountLabel(items.length, hasMore)}
        </ProductText>
        <PresentationIcon color={colors.textDim} name="chevronForward" size={18} />
      </View>
      {first === undefined ? null : <InlineQueueSummary item={first} />}
      {second === undefined ? null : <InlineQueueSummary item={second} />}
    </Pressable>
  );
}

function InlineQueueSummary(props: InlineQueueSummaryProps): React.JSX.Element {
  const { item } = props;
  return (
    <ProductText ellipsizeMode="tail" numberOfLines={1} style={styles.summary}>
      {item.summary === "" ? "Queued attachment" : item.summary}
    </ProductText>
  );
}

function queueCountLabel(count: number, hasMore: boolean): string {
  if (count === 0 && hasMore) return "More queued prompts";
  if (hasMore) return `${count}+ queued prompts`;
  return count === 1 ? "1 queued prompt" : `${count} queued prompts`;
}

function queueAccessibilityCount(count: number, hasMore: boolean): string {
  if (count === 0 && hasMore) return "more prompts available";
  return hasMore ? `${count} or more waiting` : `${count} waiting`;
}

function statusColor(items: QueueRowModel[]): string {
  if (items.some((item) => item.state === "failed")) return colors.red;
  if (items.some((item) => item.state === "uncertain")) return colors.amber;
  return colors.textMuted;
}

function rootStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.root, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  header: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  pressed: { opacity: 0.68 },
  root: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    gap: spacing.xxs,
    marginHorizontal: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  summary: { color: colors.textMuted, paddingLeft: 18 + spacing.sm, ...typeScale.caption },
  title: { color: colors.text, flex: 1, minWidth: 0, ...typeScale.label },
});
