import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, View } from "react-native";

import { relativeResetTime, selectWeeklyRateLimit } from "../../data/account-rate-limits";
import type { AccountUsageSource } from "../../data/account-usage-presentation";
import { formatDeviceDateTime } from "../../data/device-time";
import { colors, iconSize } from "../../theme";
import { AnimatedNumber, integerNumberFormat } from "../../ui/AnimatedNumber";
import { AppText as Text } from "../../ui/Typography";
import { AccountProviderHeading, AccountUsageRow } from "./AccountUsageRow";
import type { UsageAccountRow } from "./usageAccounts";

import { styles } from "./UsageMenu.styles";

/** Presents the existing account snapshots and stale/error states without creating another cache. */
const NO_ACCOUNT_ROWS: readonly UsageAccountRow[] = [];

export function AccountUsageSection({
  accountRows = NO_ACCOUNT_ROWS,
  accountSources,
  hasContext,
}: {
  /** One row per account across the listed servers. */
  accountRows?: readonly UsageAccountRow[] | undefined;
  accountSources: readonly AccountUsageSource[] | undefined;
  hasContext: boolean;
}) {
  const singleRateLimits =
    accountSources?.length === 1 ? (accountSources[0]?.rateLimits ?? null) : null;
  const weekly = selectWeeklyRateLimit(singleRateLimits?.snapshot ?? null);
  const loading =
    accountSources?.some(
      (source) => source.rateLimits?.status === "loading" && source.rateLimits.snapshot === null,
    ) ?? false;
  const refreshing =
    accountSources?.some(
      (source) => source.rateLimits?.status === "loading" && source.rateLimits.snapshot !== null,
    ) ?? false;
  const failed = accountSources?.some((source) => source.rateLimits?.status === "error") ?? false;
  const aggregateAccounts = (accountSources?.length ?? 0) > 1;
  const exhausted =
    accountSources?.some((source) => source.rateLimits?.accountPool?.allExhausted === true) ??
    false;
  return accountSources !== undefined && accountRows.length > 0 ? (
    <View
      style={[styles.section, hasContext && styles.dividedSection]}
      testID="usage-accounts-section"
    >
      <View style={styles.weeklyTitle}>
        <Ionicons color={colors.textMuted} name="people-outline" size={iconSize.inline} />
        <Text accessibilityRole="header" style={styles.title}>
          Accounts
        </Text>
        {(loading || refreshing) && (
          <ActivityIndicator
            accessibilityLabel="Refreshing account usage"
            color={colors.textMuted}
            size="small"
          />
        )}
      </View>
      {accountRows.map((row, index) => (
        <View key={row.key}>
          {row.provider !== null && row.provider.id !== accountRows[index - 1]?.provider?.id ? (
            <AccountProviderHeading provider={row.provider} />
          ) : null}
          <AccountUsageRow row={row} />
        </View>
      ))}
      {exhausted && (
        <Text style={styles.error}>
          {aggregateAccounts
            ? "All configured accounts are exhausted on at least one server."
            : "All configured accounts are exhausted."}
        </Text>
      )}
    </View>
  ) : aggregateAccounts ? (
    <View
      style={[styles.section, hasContext && styles.dividedSection]}
      testID="usage-accounts-section"
    >
      <View style={styles.weeklyTitle}>
        <Ionicons color={colors.textMuted} name="people-outline" size={17} />
        <Text accessibilityRole="header" style={styles.title}>
          Accounts
        </Text>
        {(loading || refreshing) && (
          <ActivityIndicator
            accessibilityLabel="Refreshing account usage"
            color={colors.textMuted}
            size="small"
          />
        )}
      </View>
      <Text style={[styles.secondaryValue, failed && styles.error]}>
        {loading
          ? "Loading…"
          : failed
            ? "Couldn’t load account usage."
            : "No account profiles available."}
      </Text>
    </View>
  ) : accountSources !== undefined ? (
    <View
      style={[styles.section, hasContext && styles.dividedSection]}
      testID="usage-weekly-section"
    >
      <View style={styles.weeklyHeader}>
        <View style={styles.weeklyTitle}>
          <Ionicons color={colors.textMuted} name="calendar-clear-outline" size={iconSize.inline} />
          <Text accessibilityRole="header" style={styles.title}>
            Weekly
          </Text>
          {(loading || refreshing) && (
            <ActivityIndicator
              accessibilityLabel="Refreshing weekly usage"
              color={colors.textMuted}
              size="small"
            />
          )}
        </View>
        {loading || weekly === null ? (
          <Text
            numberOfLines={1}
            style={[styles.weeklyValue, weekly === null && styles.unavailable]}
          >
            {loading ? "Loading…" : "Unavailable"}
          </Text>
        ) : (
          <AnimatedNumber
            accessibilityLabel={`${String(Math.round(weekly.remainingPercent))} percent of weekly usage remaining`}
            format={integerNumberFormat}
            style={styles.weeklyValue}
            suffix="% left"
            value={Math.round(weekly.remainingPercent)}
          />
        )}
      </View>
      {weekly?.window.resetsAt !== null && weekly?.window.resetsAt !== undefined && (
        <View style={styles.resetRow} testID="usage-reset-time">
          <Ionicons color={colors.textDim} name="refresh-outline" size={iconSize.indicator} />
          <Text numberOfLines={1} style={[styles.meta, styles.grow]}>
            {formatDeviceDateTime(weekly.window.resetsAt)} ·{" "}
            {relativeResetTime(weekly.window.resetsAt)}
          </Text>
        </View>
      )}
      {weekly === null && !loading && singleRateLimits?.status !== "error" && (
        <Text style={styles.meta}>This account did not return a weekly window.</Text>
      )}
      {singleRateLimits?.status === "error" && (
        <Text
          accessibilityLabel={singleRateLimits.error ?? "Could not refresh weekly usage"}
          numberOfLines={2}
          style={styles.error}
        >
          {singleRateLimits.snapshot === null
            ? "Couldn’t load weekly usage."
            : "Couldn’t refresh · showing last update"}
        </Text>
      )}
    </View>
  ) : null;
}
