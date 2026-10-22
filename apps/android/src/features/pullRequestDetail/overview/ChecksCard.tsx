import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { CheckItem, PullRequestOverview } from "../../../data/forgePullRequestContract";
import { colors, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { CardHeader, CardNote } from "./CardHeader";
import { CheckRow } from "./CheckRow";
import { checksSummaryLine, partitionChecks, settledChecksLabel } from "./checkPresentation";
import { overviewStyles as styles } from "./overview.styles";

/**
 * Checks: failing and pending first, each with its anchored actions; passed
 * checks collapse into one row that expands on tap. Unavailable checks keep
 * the plugin's reason in place.
 */
export function ChecksCard({
  anchored,
  onRun,
  overview,
  pending,
}: {
  readonly anchored: ReadonlyMap<string, readonly ActionDescriptor[]>;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly overview: PullRequestOverview;
  readonly pending: Readonly<Record<string, true>>;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const { attention, settled } = partitionChecks(overview.checkItems);
  const unavailable = overview.checks.state === "unavailable" ? overview.checks.reason : null;
  const row = (item: CheckItem): React.JSX.Element => (
    <CheckRow
      actions={anchored.get(item.checkId) ?? []}
      item={item}
      key={item.checkId}
      onRun={onRun}
      pending={pending}
    />
  );
  return (
    <View style={styles.card} testID="pull-request-checks-card">
      <CardHeader
        badge={unavailable === null ? null : "Unavailable"}
        meta={overview.checks.state === "unavailable" ? null : checksSummaryLine(overview.checks)}
        title="Checks"
      />
      {unavailable === null ? null : <CardNote text={unavailable} />}
      {attention.map(row)}
      {settled.length === 0 ? null : (
        <SettledChecks
          expanded={expanded}
          items={settled}
          label={settledChecksLabel(settled, overview.checks)}
          onToggle={() => {
            setExpanded((value) => !value);
          }}
        />
      )}
      {expanded ? settled.map(row) : null}
    </View>
  );
}

/** One row for every passed or skipped check, deferred behind a tap. */
function SettledChecks({
  expanded,
  items,
  label,
  onToggle,
}: {
  readonly expanded: boolean;
  readonly items: readonly CheckItem[];
  readonly label: string;
  readonly onToggle: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={styles.cardLine}
    >
      <Text style={[styles.body, styles.success]}>✓</Text>
      <SettledSummary items={items} label={label} />
      <Ionicons
        color={colors.textMuted}
        name={expanded ? "chevron-up" : "chevron-forward"}
        size={iconSize.inline}
      />
    </Pressable>
  );
}

function SettledSummary({
  items,
  label,
}: {
  readonly items: readonly CheckItem[];
  readonly label: string;
}): React.JSX.Element {
  return (
    <View style={styles.lineBody}>
      <Text style={styles.body}>{label}</Text>
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.meta}>
        {items.map((item) => item.name).join(" · ")}
      </Text>
    </View>
  );
}
