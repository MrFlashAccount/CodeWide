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
  const exhausted = row.value.kind === "remaining" && row.value.weekly === 0;
  return (
    <View style={styles.row} testID={`usage-account-${row.key}`}>
      <View
        accessibilityLabel={row.active ? "Account in use" : "Account not in use"}
        accessible
        style={[
          styles.dot,
          row.active
            ? { backgroundColor: exhausted ? colors.red : colors.green }
            : styles.dotInactive,
        ]}
      />
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text ellipsizeMode="middle" numberOfLines={1} style={styles.name}>
            {row.label}
          </Text>
          <AccountServers servers={row.servers} />
        </View>
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
      </View>
      <AccountUsageValue row={row} />
    </View>
  );
}

/** The shares left as rings and the weekly percentage, or a note toned by severity. */
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
  if (value.tone === "muted") {
    return <Text style={styles.mutedNote}>{value.text}</Text>;
  }
  const problem = value.tone === "problem";
  return (
    <View
      style={[styles.pill, problem ? styles.pillProblem : styles.pillAttention]}
      testID={`usage-account-${value.tone}-${row.key}`}
    >
      <Ionicons
        color={problem ? colors.red : colors.amber}
        name={problem ? "alert-circle" : "warning-outline"}
        size={iconSize.indicator}
      />
      <Text style={[styles.pillText, { color: problem ? colors.red : colors.amber }]}>
        {value.text}
      </Text>
    </View>
  );
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
  pill: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.optical,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  pillAttention: { backgroundColor: colors.warningContainer },
  pillProblem: { backgroundColor: colors.errorContainer },
  pillText: {
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
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
