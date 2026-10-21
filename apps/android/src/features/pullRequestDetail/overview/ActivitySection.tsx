import { View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { ActivityItem } from "../../../data/forgePullRequestContract";
import { compactAge } from "../../../ui/relativeAge";
import { AppText as Text } from "../../../ui/Typography";
import { CatalogActionButton } from "../actions/CatalogActionButton";
import { CardHeader, CardNote } from "./CardHeader";
import { overviewStyles as styles } from "./overview.styles";

/** Activity excerpts show two lines (N-01); the rest stays on the forge. */
const ACTIVITY_EXCERPT_LINES = 2;

/** `mikhail-p commented on plugin.rs:214`; the age sits beside it so truncation never hides it. */
function activityHeadline(item: ActivityItem): string {
  const verb = item.kind === "review" ? (item.verdictLabel ?? "reviewed") : "commented";
  const line = item.line === null ? "" : `:${String(item.line)}`;
  const location = item.path === null ? "" : ` on ${item.path}${line}`;
  return `${item.author} ${verb}${location}`;
}

/**
 * Recent forge activity as untrusted text: author, location, two-line excerpt.
 * Actions anchored to a review thread sit in that item's header.
 */
export function ActivitySection({
  anchored,
  items,
  nowMs,
  onLoadMore,
  onRun,
  pending,
}: {
  readonly anchored: ReadonlyMap<string, readonly ActionDescriptor[]>;
  readonly items: readonly ActivityItem[];
  readonly nowMs: number;
  readonly onLoadMore: (() => void) | null;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
}): React.JSX.Element {
  return (
    <View style={styles.card} testID="pull-request-activity">
      <CardHeader title="Activity" />
      {items.length === 0 ? <CardNote text="No activity yet." /> : null}
      {items.map((item) => (
        <ActivityRow
          actions={item.reviewThreadId === null ? [] : (anchored.get(item.reviewThreadId) ?? [])}
          item={item}
          key={item.id}
          nowMs={nowMs}
          onRun={onRun}
          pending={pending}
        />
      ))}
      {onLoadMore === null ? null : (
        <Text
          accessibilityRole="button"
          onPress={onLoadMore}
          style={[styles.cardLine, styles.meta]}
        >
          Show more activity
        </Text>
      )}
    </View>
  );
}

function ActivityRow({
  actions,
  item,
  nowMs,
  onRun,
  pending,
}: {
  readonly actions: readonly ActionDescriptor[];
  readonly item: ActivityItem;
  readonly nowMs: number;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
}): React.JSX.Element {
  return (
    <View style={[styles.cardLine, styles.stacked]}>
      <View style={styles.row}>
        <Text ellipsizeMode="middle" numberOfLines={1} style={[styles.meta, styles.fill]}>
          {activityHeadline(item)}
        </Text>
        <Text style={styles.meta}>{compactAge(item.createdAt, nowMs)}</Text>
        {actions.map((action) => (
          <CatalogActionButton
            action={action}
            key={action.actionId}
            onPress={onRun}
            pending={pending[action.actionId] === true}
            variant="compact"
          />
        ))}
      </View>
      {item.body.length === 0 ? null : (
        <Text ellipsizeMode="tail" numberOfLines={ACTIVITY_EXCERPT_LINES} style={styles.body}>
          {item.body}
        </Text>
      )}
    </View>
  );
}
