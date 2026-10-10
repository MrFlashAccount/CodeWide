import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, View } from "react-native";

import { serverIconOption } from "../../data/serverIcons";
import type { AccountUsageServer } from "../../data/thread-list-account-usage";
import { colors, iconSize, radii, spacing, typeScale, typeWeight } from "../../theme";
import { AnimatedNumber, integerNumberFormat } from "../../ui/AnimatedNumber";
import { InlineIcon } from "../../ui/InlineIcon";
import { ProviderIcon } from "../../ui/ProviderIcon";
import { AppText as Text } from "../../ui/Typography";
import { AccountLimitRings } from "./AccountLimitRings";
import type { UsageAccountRow } from "./usageAccounts";

const STATUS_DOT_SIZE = 8;
const STATUS_DOT_BORDER = 1.5;

/** The heading of one provider's accounts in the usage menu. */
export function AccountProviderHeading({
  provider,
}: {
  readonly provider: NonNullable<UsageAccountRow["provider"]>;
}): React.JSX.Element {
  return (
    <View
      accessibilityRole="header"
      style={styles.heading}
      testID={`usage-accounts-${provider.id}`}
    >
      <ProviderIcon color={colors.textMuted} provider={provider.id} size={iconSize.indicator} />
      <Text style={styles.headingText}>{provider.name}</Text>
    </View>
  );
}

/** One account: who, its plan and reset, and the shares left or what is wrong with it. */
export function AccountUsageRow({ row }: { readonly row: UsageAccountRow }): React.JSX.Element {
  const alert = rowAlert(row);
  return (
    <View style={styles.row} testID={`usage-account-${row.key}`}>
      <View
        accessibilityLabel={row.active ? "Account in use" : "Account not in use"}
        accessible
        style={[styles.dot, dotStyle(row, alert)]}
      />
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text ellipsizeMode="middle" numberOfLines={1} style={styles.name}>
            {row.label}
          </Text>
          <AccountServers servers={row.servers} />
        </View>
        {alert === null ? (
          <AccountMetadata row={row} />
        ) : (
          <Text
            numberOfLines={1}
            style={[styles.alert, { color: alert.color }]}
            testID={`usage-account-${alert.tone}-${row.key}`}
          >
            {alert.text}
          </Text>
        )}
      </View>
      <AccountUsageValue row={row} />
    </View>
  );
}

/** A problem or a needed refresh replaces the plan line and colors the status dot. */
interface RowAlert {
  readonly color: string;
  readonly text: string;
  readonly tone: "attention" | "problem";
}

function rowAlert(row: UsageAccountRow): RowAlert | null {
  const value = row.value;
  if (value.kind !== "note" || value.tone === "muted") {
    return null;
  }
  return {
    color: value.tone === "problem" ? colors.red : colors.amber,
    text: value.text,
    tone: value.tone,
  };
}

function dotStyle(row: UsageAccountRow, alert: RowAlert | null) {
  if (alert !== null) {
    return { backgroundColor: alert.color };
  }
  if (!row.active) {
    return styles.dotInactive;
  }
  const exhausted = row.value.kind === "remaining" && row.value.weekly === 0;
  return { backgroundColor: exhausted ? colors.red : colors.green };
}

/** The plan and, when known, the time to the weekly reset. */
function AccountMetadata({ row }: { readonly row: UsageAccountRow }) {
  return (
    <View
      accessibilityLabel={`${row.plan}${row.resetsIn === null ? "" : ` · resets in ${row.resetsIn}`}`}
      accessible
      style={styles.metadataRow}
    >
      <Text numberOfLines={1} style={styles.metadata}>
        {row.plan}
      </Text>
      {row.resetsIn === null ? null : (
        <>
          <Text style={styles.metadata}>·</Text>
          <Ionicons color={colors.textDim} name="refresh-outline" size={iconSize.indicator} />
          <Text numberOfLines={1} style={styles.metadata}>
            {row.resetsIn}
          </Text>
        </>
      )}
    </View>
  );
}

/** The shares left as rings and the weekly percentage, or a muted note. */
function AccountUsageValue({ row }: { readonly row: UsageAccountRow }) {
  const value = row.value;
  if (value.kind === "remaining") {
    return (
      <View style={styles.value}>
        <AccountLimitRings
          fiveHour={
            value.fiveHour === null
              ? { kind: "absent" }
              : { kind: "present", remainingPercent: value.fiveHour }
          }
          size="inline"
          testID={`usage-account-rings-${row.key}`}
          weeklyRemainingPercent={value.weekly}
        />
        <AnimatedNumber
          format={integerNumberFormat}
          style={styles.percent}
          suffix="%"
          value={value.weekly}
        />
      </View>
    );
  }
  // A problem or a needed refresh is told on the plan line instead.
  return value.tone === "muted" ? <Text style={styles.mutedNote}>{value.text}</Text> : null;
}

/** The servers of an account as their icons; the names are the accessibility label. */
function AccountServers({ servers }: { readonly servers: readonly AccountUsageServer[] }) {
  if (servers.length === 0) {
    return null;
  }
  return (
    <View
      accessibilityLabel={`On ${servers.map((server) => server.name).join(", ")}`}
      accessible
      style={styles.servers}
      testID="usage-account-servers"
    >
      {servers.map((server) => (
        <InlineIcon
          color={colors.textDim}
          key={server.id}
          name={serverIconOption(server.iconId).name}
          role="caption"
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  alert: {
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
  },
  content: {
    flex: 1,
    gap: spacing.xxs,
    minWidth: 0,
  },
  dot: {
    borderRadius: radii.pill,
    height: STATUS_DOT_SIZE,
    width: STATUS_DOT_SIZE,
  },
  dotInactive: {
    borderColor: colors.textDim,
    borderWidth: STATUS_DOT_BORDER,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  headingText: {
    ...typeScale.caption,
    color: colors.textMuted,
    fontWeight: typeWeight.semibold,
    textTransform: "uppercase",
  },
  metadata: {
    ...typeScale.caption,
    color: colors.textDim,
    flexShrink: 0,
  },
  metadataRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.optical,
    minWidth: 0,
  },
  mutedNote: {
    ...typeScale.label,
    color: colors.textMuted,
    flexShrink: 0,
  },
  name: {
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.body,
    color: colors.text,
  },
  percent: {
    ...typeScale.body,
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  servers: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.optical,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  value: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.xs,
  },
});
