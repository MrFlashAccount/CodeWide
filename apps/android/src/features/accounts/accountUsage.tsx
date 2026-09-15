import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, View } from "react-native";

import {
  accountProfileRateLimitsStale,
  relativeResetTime,
  selectWeeklyRateLimit,
} from "../../data/account-rate-limits";
import {
  accountUsageProfiles,
  type AccountUsageSource,
} from "../../data/account-usage-presentation";
import { formatDeviceDateTime } from "../../data/device-time";
import { colors, iconSize } from "../../theme";
import { AnimatedNumber, integerNumberFormat } from "../../ui/AnimatedNumber";
import { AppText as Text } from "../../ui/Typography";
import { AccountUsageRow } from "./AccountUsageRow";

import { styles } from "./UsagePopover.styles";

/** Presents the existing account snapshots and stale/error states without creating another cache. */
export function AccountUsageSection({
  accountSources,
  hasContext,
}: {
  accountSources: readonly AccountUsageSource[] | undefined;
  hasContext: boolean;
}) {
  const singleRateLimits =
    accountSources?.length === 1 ? (accountSources[0]?.rateLimits ?? null) : null;
  const weekly = selectWeeklyRateLimit(singleRateLimits?.snapshot ?? null);
  const accountProfiles = accountUsageProfiles(accountSources ?? []);
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
  return accountSources !== undefined && accountProfiles.length > 0 ? (
    <View
      testID="usage-accounts-section"
      style={[styles.section, hasContext && styles.dividedSection]}
    >
      <View style={styles.weeklyTitle}>
        <Ionicons name="people-outline" size={iconSize.inline} color={colors.textMuted} />
        <Text accessibilityRole="header" style={styles.title}>
          Accounts
        </Text>
        {(loading || refreshing) && (
          <ActivityIndicator
            accessibilityLabel="Refreshing account usage"
            size="small"
            color={colors.textMuted}
          />
        )}
      </View>
      {accountProfiles.map((account) => {
        const profile = account.profile;
        const profileWeekly = selectWeeklyRateLimit(profile.rateLimits);
        const resetAt = profile.exhaustedUntil ?? profileWeekly?.window.resetsAt ?? null;
        const profileStale = profile.enabled && accountProfileRateLimitsStale(profile);
        return (
          <AccountUsageRow
            key={account.id}
            testID={`usage-account-${profile.id}`}
            label={account.label}
            plan={account.detail}
            status={
              !profile.enabled
                ? "disabled"
                : profile.exhaustedUntil !== null ||
                    profile.exhaustedIndefinitely ||
                    profileWeekly?.remainingPercent === 0
                  ? "exhausted"
                  : profile.active
                    ? "active"
                    : "inactive"
            }
            reset={
              profile.enabled && !profileStale && resetAt !== null
                ? { absolute: formatDeviceDateTime(resetAt), relative: relativeResetTime(resetAt) }
                : null
            }
          >
            {!profile.enabled || profileStale || profileWeekly === null ? (
              <Text style={[styles.secondaryValue, styles.unavailable]}>
                {!profile.enabled
                  ? "Disabled"
                  : profileStale
                    ? "Refresh required"
                    : profile.exhaustedIndefinitely
                      ? "Limit reached"
                      : "Unavailable"}
              </Text>
            ) : (
              <AnimatedNumber
                value={Math.round(profileWeekly.remainingPercent)}
                format={integerNumberFormat}
                suffix="% left"
                style={styles.accountValue}
              />
            )}
          </AccountUsageRow>
        );
      })}
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
      testID="usage-accounts-section"
      style={[styles.section, hasContext && styles.dividedSection]}
    >
      <View style={styles.weeklyTitle}>
        <Ionicons name="people-outline" size={17} color={colors.textMuted} />
        <Text accessibilityRole="header" style={styles.title}>
          Accounts
        </Text>
        {(loading || refreshing) && (
          <ActivityIndicator
            accessibilityLabel="Refreshing account usage"
            size="small"
            color={colors.textMuted}
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
      testID="usage-weekly-section"
      style={[styles.section, hasContext && styles.dividedSection]}
    >
      <View style={styles.weeklyHeader}>
        <View style={styles.weeklyTitle}>
          <Ionicons name="calendar-clear-outline" size={iconSize.inline} color={colors.textMuted} />
          <Text accessibilityRole="header" style={styles.title}>
            Weekly
          </Text>
          {(loading || refreshing) && (
            <ActivityIndicator
              accessibilityLabel="Refreshing weekly usage"
              size="small"
              color={colors.textMuted}
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
            accessibilityLabel={`${Math.round(weekly.remainingPercent)} percent of weekly usage remaining`}
            value={Math.round(weekly.remainingPercent)}
            format={integerNumberFormat}
            suffix="% left"
            style={styles.weeklyValue}
          />
        )}
      </View>
      {weekly?.window.resetsAt !== null && weekly?.window.resetsAt !== undefined && (
        <View testID="usage-reset-time" style={styles.resetRow}>
          <Ionicons name="refresh-outline" size={iconSize.indicator} color={colors.textDim} />
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
