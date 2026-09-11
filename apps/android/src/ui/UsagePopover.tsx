import Ionicons from "@expo/vector-icons/Ionicons";
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { TurnUsageProjection } from "@codewide/sync-client";
import { AppPopover } from "./AppPopover";
import { useState, type ReactElement } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions, type PressableProps } from "react-native";
import Svg, { Circle } from "react-native-svg";

import {
  accountProfileRateLimitsStale,
  accountRateLimitsStale,
  contextUsageFromProjection,
  currentThreadUsageProjection,
  relativeResetTime,
  selectWeeklyRateLimit,
} from "../data/account-rate-limits";
import { accountUsageProfiles, type AccountUsageSource } from "../data/account-usage-presentation";
import { colors, spacing, touchTarget, typeScale, typeWeight, iconSize, controlSize, layoutSize } from "../theme";
import { formatEstimatedTurnCost } from "../turn-cost";
import { AnimatedNumber, compactNumberFormat, integerNumberFormat, usdNumberFormat } from "./AnimatedNumber";
import { SessionUsageDetails } from "./SessionUsageDetails";
import { AccountUsageRow } from "./AccountUsageRow";
import { formatDeviceDateTime } from "../data/device-time";
import { AppText as Text } from "./Typography";
import { TOKEN_SYMBOL } from "./token-display";

type UsagePopoverAction = {
  id: string;
  label: string;
  description?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress(): void;
};

export function UsagePopover({
  children,
  thread,
  currentUsage,
  compactionCount,
  accountSources,
  onRefresh,
  actions = [],
  placement = "top",
  align = "start",
}: {
  children: ReactElement<PressableProps>;
  thread?: Thread | null;
  currentUsage?: TurnUsageProjection | null;
  compactionCount?: number | null;
  accountSources?: readonly AccountUsageSource[];
  onRefresh?(): Promise<unknown>;
  actions?: UsagePopoverAction[];
  placement?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [sessionExpanded, setSessionExpanded] = useState(false);
  const { width } = useWindowDimensions();
  const usageProjection = currentUsage === undefined ? currentThreadUsageProjection(thread) : currentUsage;
  const context = contextUsageFromProjection(usageProjection);
  const sessionUsage = usageProjection?.thread.tokens ?? null;
  const sessionCost = usageProjection?.thread.cost ?? null;
  const singleRateLimits = accountSources?.length === 1 ? accountSources[0]?.rateLimits ?? null : null;
  const weekly = selectWeeklyRateLimit(singleRateLimits?.snapshot ?? null);
  const accountProfiles = accountUsageProfiles(accountSources ?? []);
  const loading = accountSources?.some((source) => source.rateLimits?.status === "loading" && source.rateLimits.snapshot === null) ?? false;
  const refreshing = accountSources?.some((source) => source.rateLimits?.status === "loading" && source.rateLimits.snapshot !== null) ?? false;
  const failed = accountSources?.some((source) => source.rateLimits?.status === "error") ?? false;
  const aggregateAccounts = (accountSources?.length ?? 0) > 1;
  const exhausted = accountSources?.some((source) => source.rateLimits?.accountPool?.allExhausted === true) ?? false;
  const contentWidth = Math.max(1, Math.min(312, width - 24));
  const sessionAccessibilityLabel = [
    sessionUsage === null ? "token usage unavailable" : `${sessionUsage.totalTokens.toLocaleString()} tokens`,
    sessionCost === null ? "cost unavailable" : `estimated cost ${formatEstimatedTurnCost(sessionCost.totalCostUsd)}`,
  ].join(", ");
  const hasLeadingSection = thread !== undefined || accountSources !== undefined;
  const openChanged = (open: boolean) => {
    setOpen(open);
    if (!open) setSessionExpanded(false);
    if (open && accountSources?.some((source) => accountRateLimitsStale(source.rateLimits)) === true && onRefresh !== undefined) void onRefresh().catch(() => undefined);
  };

  return (
    <AppPopover open={open} onOpenChange={openChanged} trigger={children} width={contentWidth} placement={placement} align={align}>
          <View testID="usage-popover" style={styles.content}>
            {thread !== undefined && (
              <View testID="usage-context-section" style={styles.section}>
                <Text accessibilityRole="header" style={styles.title}>Context</Text>
                <View style={styles.contextSummary}>
                  <ContextRing percent={context?.usedPercent ?? 0} size={46} showValue={context !== null} />
                  <View style={styles.grow}>
                    {context === null ? (
                      <Text numberOfLines={1} style={[styles.primaryValue, styles.unavailable]}>Usage unavailable</Text>
                    ) : (
                      <AnimatedNumber
                        accessibilityLabel={`${context.usedTokens.toLocaleString()} of ${context.totalTokens.toLocaleString()} context tokens used`}
                        value={context.usedTokens}
                        format={compactNumberFormat}
                        prefix={TOKEN_SYMBOL}
                        suffix={` / ${compactNumber(context.totalTokens)}`}
                        style={styles.primaryValue}
                      />
                    )}
                    {context === null ? (
                      <Text numberOfLines={1} style={styles.secondaryValue}>No token data for this thread</Text>
                    ) : (
                      <AnimatedNumber value={context.remainingTokens} format={compactNumberFormat} prefix={TOKEN_SYMBOL} suffix=" available" style={styles.secondaryValue} />
                    )}
                  </View>
                </View>
              </View>
            )}

            {accountSources !== undefined && accountProfiles.length > 0 ? (
              <View testID="usage-accounts-section" style={[styles.section, thread !== undefined && styles.dividedSection]}>
                <View style={styles.weeklyTitle}>
                  <Ionicons name="people-outline" size={iconSize.inline} color={colors.textMuted} />
                  <Text accessibilityRole="header" style={styles.title}>Accounts</Text>
                  {(loading || refreshing) && <ActivityIndicator accessibilityLabel="Refreshing account usage" size="small" color={colors.textMuted} />}
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
                      status={!profile.enabled ? "disabled" : profile.exhaustedUntil !== null || profile.exhaustedIndefinitely || profileWeekly?.remainingPercent === 0 ? "exhausted" : profile.active ? "active" : "inactive"}
                      reset={profile.enabled && !profileStale && resetAt !== null ? { absolute: formatDeviceDateTime(resetAt), relative: relativeResetTime(resetAt) } : null}
                    >
                        {!profile.enabled || profileStale || profileWeekly === null ? (
                          <Text style={[styles.secondaryValue, styles.unavailable]}>{!profile.enabled ? "Disabled" : profileStale ? "Refresh required" : profile.exhaustedIndefinitely ? "Limit reached" : "Unavailable"}</Text>
                        ) : (
                          <AnimatedNumber value={Math.round(profileWeekly.remainingPercent)} format={integerNumberFormat} suffix="% left" style={styles.accountValue} />
                        )}
                    </AccountUsageRow>
                  );
                })}
                {exhausted && <Text style={styles.error}>{aggregateAccounts ? "All configured accounts are exhausted on at least one server." : "All configured accounts are exhausted."}</Text>}
              </View>
            ) : aggregateAccounts ? <View testID="usage-accounts-section" style={[styles.section, thread !== undefined && styles.dividedSection]}>
              <View style={styles.weeklyTitle}>
                <Ionicons name="people-outline" size={17} color={colors.textMuted} />
                <Text accessibilityRole="header" style={styles.title}>Accounts</Text>
                {(loading || refreshing) && <ActivityIndicator accessibilityLabel="Refreshing account usage" size="small" color={colors.textMuted} />}
              </View>
              <Text style={[styles.secondaryValue, failed && styles.error]}>{loading ? "Loading…" : failed ? "Couldn’t load account usage." : "No account profiles available."}</Text>
            </View> : accountSources !== undefined ? <View testID="usage-weekly-section" style={[styles.section, thread !== undefined && styles.dividedSection]}>
              <View style={styles.weeklyHeader}>
                <View style={styles.weeklyTitle}>
                  <Ionicons name="calendar-clear-outline" size={iconSize.inline} color={colors.textMuted} />
                  <Text accessibilityRole="header" style={styles.title}>Weekly</Text>
                  {(loading || refreshing) && <ActivityIndicator accessibilityLabel="Refreshing weekly usage" size="small" color={colors.textMuted} />}
                </View>
                {loading || weekly === null ? (
                  <Text numberOfLines={1} style={[styles.weeklyValue, weekly === null && styles.unavailable]}>{loading ? "Loading…" : "Unavailable"}</Text>
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
                  <Text numberOfLines={1} style={[styles.meta, styles.grow]}>{formatDeviceDateTime(weekly.window.resetsAt)} · {relativeResetTime(weekly.window.resetsAt)}</Text>
                </View>
              )}
              {weekly === null && !loading && singleRateLimits?.status !== "error" && <Text style={styles.meta}>This account did not return a weekly window.</Text>}
              {singleRateLimits?.status === "error" && (
                <Text accessibilityLabel={singleRateLimits.error ?? "Could not refresh weekly usage"} numberOfLines={2} style={styles.error}>
                  {singleRateLimits.snapshot === null ? "Couldn’t load weekly usage." : "Couldn’t refresh · showing last update"}
                </Text>
              )}
            </View> : null}

            {thread !== undefined && (
              <View testID="usage-session-section" style={[styles.section, styles.dividedSection]}>
                <Pressable
                  testID="usage-session-summary"
                  accessibilityRole="button"
                  accessibilityLabel={`Session usage, ${sessionAccessibilityLabel}`}
                  accessibilityHint={sessionExpanded ? "Hides the token and cost breakdown" : "Shows the token and cost breakdown"}
                  accessibilityState={{ expanded: sessionExpanded }}
                  hitSlop={4}
                  onPress={() => setSessionExpanded((expanded) => !expanded)}
                  style={({ pressed }) => [styles.sessionSummaryRow, pressed && styles.pressed]}
                >
                  <Ionicons name="analytics-outline" size={iconSize.inline} color={colors.textMuted} />
                  <Text style={styles.title}>Session</Text>
                  <View style={styles.sessionSummaryValues}>
                    {sessionUsage !== null && (
                      <AnimatedNumber value={sessionUsage.totalTokens} format={compactNumberFormat} prefix={TOKEN_SYMBOL} style={styles.sessionSummaryText} testID="usage-session-tokens" />
                    )}
                    {sessionUsage !== null && sessionCost !== null && <Text style={styles.sessionSummarySeparator}>·</Text>}
                    {sessionCost !== null && (
                      <AnimatedNumber value={sessionCost.totalCostUsd} format={usdNumberFormat(sessionCost.totalCostUsd)} prefix="≈" style={styles.sessionCostText} testID="usage-session-cost" />
                    )}
                    {sessionUsage === null && sessionCost === null && (
                      <Text numberOfLines={1} style={styles.sessionSummaryText}>Unavailable</Text>
                    )}
                  </View>
                  <Ionicons name={sessionExpanded ? "chevron-up" : "chevron-down"} size={iconSize.inline} color={colors.textDim} />
                </Pressable>
                {sessionExpanded && (
                  <SessionUsageDetails
                    tokens={sessionUsage === null ? null : {
                      input: sessionUsage.inputTokens,
                      cached: sessionUsage.cachedInputTokens,
                      output: sessionUsage.outputTokens,
                      total: sessionUsage.totalTokens,
                    }}
                    cost={sessionCost === null ? null : {
                      input: sessionCost.uncachedInputCostUsd + sessionCost.cachedInputCostUsd + sessionCost.cacheWriteInputCostUsd,
                      cached: sessionCost.cachedInputCostUsd,
                      output: sessionCost.outputCostUsd,
                      total: sessionCost.totalCostUsd,
                    }}
                    compactionCount={compactionCount ?? null}
                  />
                )}
              </View>
            )}

            {actions.map((action, index) => (
              <Pressable
                key={action.id}
                accessibilityRole="button"
                accessibilityLabel={action.description === undefined ? action.label : `${action.label}, ${action.description}`}
                onPress={() => {
                  setOpen(false);
                  action.onPress();
                }}
                style={({ pressed }) => [styles.action, hasLeadingSection && index === 0 && styles.dividedAction, pressed && styles.pressed]}
              >
                <View style={styles.actionIcon}><Ionicons name={action.icon} size={iconSize.action} color={colors.textMuted} /></View>
                <View style={styles.grow}>
                  <Text style={styles.actionTitle}>{action.label}</Text>
                  {action.description !== undefined && <Text numberOfLines={1} style={styles.meta}>{action.description}</Text>}
                </View>
              </Pressable>
            ))}
          </View>
    </AppPopover>
  );
}

export function ContextRing({ percent, size = 22, showValue = false }: { percent: number; size?: number; showValue?: boolean }) {
  const strokeWidth = Math.max(2, size * 0.12);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, percent));
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`${Math.round(progress)}% context used`} style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.surfaceContainerHighest} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={progress >= 85 ? colors.amber : colors.accent}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - progress / 100)}
          fill="none"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {showValue && (
        <View pointerEvents="none" style={styles.contextRingLabel}>
          <AnimatedNumber
            value={Math.round(progress)}
            format={integerNumberFormat}
            suffix="%"
            style={[styles.contextRingLabelText, { fontSize: size * 0.22, lineHeight: size * 0.26 }]}
            containerStyle={styles.contextRingNumber}
          />
        </View>
      )}
    </View>
  );
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const styles = StyleSheet.create({
  content: { paddingVertical: spacing.xxs },
  section: { gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  dividedSection: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sessionSummaryRow: { minHeight: controlSize.regular, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  sessionSummaryValues: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.xxs },
  sessionSummaryText: { flexShrink: 1, minWidth: 0, textAlign: "right", color: colors.textMuted, ...typeScale.label, fontVariant: ["tabular-nums"] },
  sessionSummarySeparator: { flexShrink: 0, color: colors.textMuted, ...typeScale.label, },
  sessionCostText: { flexShrink: 0, color: colors.textMuted, ...typeScale.label, fontVariant: ["tabular-nums"] },
  contextSummary: { minHeight: layoutSize.header, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  contextRingLabel: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
  contextRingNumber: { width: "100%", alignItems: "center" },
  contextRingLabelText: { width: "100%", color: colors.text, fontWeight: typeWeight.semibold, textAlign: "center", includeFontPadding: false },
  grow: { flex: 1, minWidth: 0 },
  title: { color: colors.textMuted, ...typeScale.label },
  primaryValue: { color: colors.text, ...typeScale.heading, fontWeight: typeWeight.semibold, fontVariant: ["tabular-nums"] },
  secondaryValue: { color: colors.textMuted, ...typeScale.body, fontVariant: ["tabular-nums"] },
  meta: { color: colors.textDim, ...typeScale.label, },
  unavailable: { color: colors.textMuted },
  weeklyHeader: { minHeight: controlSize.compact, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.xs },
  weeklyTitle: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  weeklyValue: { flexShrink: 1, color: colors.text, ...typeScale.title, fontWeight: typeWeight.semibold, fontVariant: ["tabular-nums"] },
  accountValue: { flexShrink: 0, color: colors.text, ...typeScale.body, fontVariant: ["tabular-nums"] },
  resetRow: { minHeight: layoutSize.metadataRow, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  action: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm },
  dividedAction: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actionIcon: { width: 20, height: 20, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  actionTitle: { color: colors.text, ...typeScale.body },
  error: { color: colors.red, ...typeScale.label, },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
