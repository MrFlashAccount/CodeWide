import Ionicons from "@expo/vector-icons/Ionicons";
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { Popover } from "heroui-native/popover";
import { useState, type ReactElement } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle } from "react-native-svg";

import {
  accountRateLimitsStale,
  currentThreadContextUsage,
  currentThreadUsageProjection,
  relativeResetTime,
  selectWeeklyRateLimit,
  type AccountRateLimitsRow,
} from "../data/account-rate-limits";
import { accountProfileLabel } from "../data/account-pool";
import { colors, radii, spacing, touchTarget, typeScale } from "../theme";
import { formatEstimatedTurnCost } from "../turn-cost";
import { AnimatedNumber, compactNumberFormat, integerNumberFormat, usdNumberFormat } from "./AnimatedNumber";
import { AnimatedBreakdownRow, BreakdownRow } from "./CostBreakdownPopover";
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
  model,
  compactionCount,
  rateLimits = null,
  onRefresh,
  actions = [],
  showAccountLimits = true,
  placement = "top",
  align = "start",
}: {
  children: ReactElement;
  thread?: Thread | null;
  model?: string | null;
  compactionCount?: number | null;
  rateLimits?: AccountRateLimitsRow | null;
  onRefresh?(): Promise<unknown>;
  actions?: UsagePopoverAction[];
  showAccountLimits?: boolean;
  placement?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [sessionExpanded, setSessionExpanded] = useState(false);
  const { height, width } = useWindowDimensions();
  const context = thread === undefined ? null : currentThreadContextUsage(thread);
  const usageProjection = thread === undefined ? null : currentThreadUsageProjection(thread);
  const sessionUsage = usageProjection?.thread.tokens ?? null;
  const sessionCost = usageProjection?.thread.cost ?? null;
  const weekly = selectWeeklyRateLimit(rateLimits?.snapshot ?? null);
  const accountProfiles = rateLimits?.accountPool?.profiles ?? [];
  const loading = rateLimits?.status === "loading" && rateLimits.snapshot === null;
  const refreshing = rateLimits?.status === "loading" && rateLimits.snapshot !== null;
  const contentWidth = Math.max(1, Math.min(312, width - 24));
  const contentMaxHeight = Math.max(1, height - 24);
  const sessionAccessibilityLabel = [
    sessionUsage === null ? "token usage unavailable" : `${sessionUsage.totalTokens.toLocaleString()} tokens`,
    sessionCost === null ? "cost unavailable" : `estimated cost ${formatEstimatedTurnCost(sessionCost.totalCostUsd)}`,
  ].join(", ");
  const hasLeadingSection = thread !== undefined || showAccountLimits;
  const openChanged = (open: boolean) => {
    setOpen(open);
    if (!open) setSessionExpanded(false);
    if (open && showAccountLimits && onRefresh !== undefined && accountRateLimitsStale(rateLimits)) void onRefresh().catch(() => undefined);
  };

  return (
    <Popover presentation="popover" isOpen={open} onOpenChange={openChanged}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Overlay className="bg-backdrop" />
        <Popover.Content
          presentation="popover"
          placement={placement}
          align={align}
          offset={8}
          width={contentWidth}
          className="border border-border"
          style={StyleSheet.flatten([styles.popover, { maxHeight: contentMaxHeight }])}
        >
          <ScrollView testID="usage-popover" style={{ maxHeight: contentMaxHeight }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
                    {model !== null && model !== undefined && <Text numberOfLines={1} style={styles.meta}>{model}</Text>}
                  </View>
                </View>
              </View>
            )}

            {showAccountLimits && accountProfiles.length > 0 ? (
              <View testID="usage-accounts-section" style={[styles.section, thread !== undefined && styles.dividedSection]}>
                <View style={styles.weeklyTitle}>
                  <Ionicons name="people-outline" size={17} color={colors.textMuted} />
                  <Text accessibilityRole="header" style={styles.title}>Accounts</Text>
                  {(loading || refreshing) && <ActivityIndicator accessibilityLabel="Refreshing account usage" size="small" color={colors.textMuted} />}
                </View>
                {accountProfiles.map((profile, index) => {
                  const profileWeekly = selectWeeklyRateLimit(profile.rateLimits);
                  const resetAt = profile.exhaustedUntil ?? profileWeekly?.window.resetsAt ?? null;
                  return (
                    <View key={profile.id} testID={`usage-account-${profile.id}`} style={[styles.accountRow, index > 0 && styles.accountDivider]}>
                      <View style={styles.accountTitleRow}>
                        <View style={[styles.accountStateDot, { backgroundColor: profile.active ? colors.green : profile.exhaustedUntil !== null || profile.exhaustedIndefinitely ? colors.red : colors.textDim }]} />
                        <View style={styles.grow}>
                          <Text numberOfLines={1} style={styles.accountName}>{accountProfileLabel(profile, index)}</Text>
                          <Text numberOfLines={1} style={styles.meta}>{profile.planType ?? "Plan unavailable"}{profile.active ? " · active" : ""}</Text>
                        </View>
                        {profileWeekly === null ? (
                          <Text style={[styles.secondaryValue, styles.unavailable]}>{profile.exhaustedIndefinitely ? "Limit reached" : "Unavailable"}</Text>
                        ) : (
                          <AnimatedNumber value={Math.round(profileWeekly.remainingPercent)} format={integerNumberFormat} suffix="% left" style={styles.accountValue} />
                        )}
                      </View>
                      {resetAt !== null && (
                        <View style={styles.resetRow}>
                          <Text numberOfLines={1} style={[styles.meta, styles.grow]}>Resets {formatAbsoluteReset(resetAt)}</Text>
                          <Text numberOfLines={1} style={styles.relativeReset}>{relativeResetTime(resetAt)}</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
                {rateLimits?.accountPool?.allExhausted === true && <Text style={styles.error}>All configured accounts are exhausted.</Text>}
              </View>
            ) : showAccountLimits ? <View testID="usage-weekly-section" style={[styles.section, thread !== undefined && styles.dividedSection]}>
              <View style={styles.weeklyHeader}>
                <View style={styles.weeklyTitle}>
                  <Ionicons name="calendar-clear-outline" size={17} color={colors.textMuted} />
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
                  <Text numberOfLines={1} style={[styles.secondaryValue, styles.grow]}>Resets {formatAbsoluteReset(weekly.window.resetsAt)}</Text>
                  <Text numberOfLines={1} style={styles.relativeReset}>{relativeResetTime(weekly.window.resetsAt)}</Text>
                </View>
              )}
              {weekly === null && !loading && rateLimits?.status !== "error" && <Text style={styles.meta}>This account did not return a weekly window.</Text>}
              {rateLimits?.status === "error" && (
                <Text accessibilityLabel={rateLimits.error ?? "Could not refresh weekly usage"} numberOfLines={2} style={styles.error}>
                  {rateLimits.snapshot === null ? "Couldn’t load weekly usage." : "Couldn’t refresh · showing last update"}
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
                  <Ionicons name="analytics-outline" size={17} color={colors.textMuted} />
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
                  <Ionicons name={sessionExpanded ? "chevron-up" : "chevron-down"} size={15} color={colors.textDim} />
                </Pressable>
                {sessionExpanded && (
                  <View testID="usage-session-details" style={styles.sessionDetails}>
                    {sessionUsage === null ? (
                      <Text style={styles.secondaryValue}>Token usage unavailable</Text>
                    ) : (
                      <>
                        {sessionCost === null ? (
                          <>
                            <AnimatedBreakdownRow label="Input" value={sessionUsage.inputTokens} prefix={TOKEN_SYMBOL} />
                            <AnimatedBreakdownRow label="Output" value={sessionUsage.outputTokens} prefix={TOKEN_SYMBOL} />
                            <AnimatedBreakdownRow label="Total" value={sessionUsage.totalTokens} prefix={TOKEN_SYMBOL} />
                          </>
                        ) : (
                          <>
                            <SessionUsageRow
                              testID="usage-session-input"
                              label="Input"
                              tokens={sessionUsage.inputTokens}
                              costUsd={sessionCost.uncachedInputCostUsd + sessionCost.cachedInputCostUsd + sessionCost.cacheWriteInputCostUsd}
                            />
                            <SessionUsageRow testID="usage-session-output" label="Output" tokens={sessionUsage.outputTokens} costUsd={sessionCost.outputCostUsd} />
                            <SessionUsageRow testID="usage-session-total" label="Total" tokens={sessionUsage.totalTokens} costUsd={sessionCost.totalCostUsd} emphasized />
                          </>
                        )}
                      </>
                    )}
                    {compactionCount === undefined || compactionCount === null
                      ? <BreakdownRow label="Compactions" value="History not loaded" />
                      : <AnimatedBreakdownRow label="Compactions" value={compactionCount} />}
                    <Text style={styles.meta}>
                      {sessionCost === null
                        ? "Cost unavailable for the current model."
                        : "API-equivalent session estimate at the current model price. Model switches and per-request long-context premiums are not reconstructed."}
                    </Text>
                  </View>
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
                style={({ pressed }) => [styles.action, (hasLeadingSection || index > 0) && styles.dividedAction, pressed && styles.pressed]}
              >
                <View style={styles.actionIcon}><Ionicons name={action.icon} size={18} color={colors.textMuted} /></View>
                <View style={styles.grow}>
                  <Text style={styles.actionTitle}>{action.label}</Text>
                  {action.description !== undefined && <Text numberOfLines={1} style={styles.meta}>{action.description}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
              </Pressable>
            ))}
          </ScrollView>
          <Popover.Arrow />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

function SessionUsageRow({
  testID,
  label,
  tokens,
  costUsd,
  emphasized = false,
}: {
  testID: string;
  label: string;
  tokens: number;
  costUsd: number;
  emphasized?: boolean;
}) {
  return (
    <View testID={testID} style={[styles.sessionUsageRow, emphasized && styles.sessionUsageTotalRow]}>
      <Text style={[styles.sessionUsageLabel, emphasized && styles.sessionUsageTotalText]}>{label}</Text>
      <View style={styles.sessionUsageValues}>
        <AnimatedNumber value={tokens} format={integerNumberFormat} prefix={TOKEN_SYMBOL} style={[styles.sessionUsageValue, emphasized && styles.sessionUsageTotalText]} />
        <Text style={[styles.sessionUsageValue, emphasized && styles.sessionUsageTotalText]}>·</Text>
        <AnimatedNumber value={costUsd} format={usdNumberFormat(costUsd)} style={[styles.sessionUsageValue, emphasized && styles.sessionUsageTotalText]} />
      </View>
    </View>
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

function formatAbsoluteReset(resetsAt: number): string {
  return new Date(resetsAt * 1_000).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const styles = StyleSheet.create({
  popover: { padding: 0, borderRadius: radii.large, overflow: "hidden" },
  content: { paddingVertical: spacing.xxs },
  section: { gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  dividedSection: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sessionSummaryRow: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  sessionSummaryValues: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  sessionSummaryText: { flexShrink: 1, minWidth: 0, textAlign: "right", color: colors.textMuted, fontSize: 11, lineHeight: 15, fontVariant: ["tabular-nums"] },
  sessionSummarySeparator: { flexShrink: 0, color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  sessionCostText: { flexShrink: 0, color: colors.textMuted, fontSize: 11, lineHeight: 15, fontVariant: ["tabular-nums"] },
  sessionDetails: { gap: 2, paddingBottom: 2 },
  sessionUsageRow: { minHeight: 25, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  sessionUsageLabel: { flexShrink: 1, color: colors.textMuted, ...typeScale.bodyMedium },
  sessionUsageValues: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4 },
  sessionUsageValue: { flexShrink: 0, color: colors.text, fontSize: 12, lineHeight: 17, fontVariant: ["tabular-nums"] },
  sessionUsageTotalRow: { minHeight: 30, marginTop: 3, paddingTop: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sessionUsageTotalText: { color: colors.text, fontWeight: "700" },
  contextSummary: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  contextRingLabel: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
  contextRingNumber: { width: "100%", alignItems: "center" },
  contextRingLabelText: { width: "100%", color: colors.text, fontWeight: "600", textAlign: "center", includeFontPadding: false },
  grow: { flex: 1, minWidth: 0 },
  title: { color: colors.textMuted, ...typeScale.labelMedium },
  primaryValue: { color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: "600", fontVariant: ["tabular-nums"] },
  secondaryValue: { color: colors.textMuted, ...typeScale.bodyMedium, fontVariant: ["tabular-nums"] },
  meta: { color: colors.textDim, fontSize: 11, lineHeight: 15 },
  unavailable: { color: colors.textMuted },
  weeklyHeader: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.xs },
  weeklyTitle: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  weeklyValue: { flexShrink: 1, color: colors.text, ...typeScale.titleMedium, fontWeight: "600", fontVariant: ["tabular-nums"] },
  accountRow: { gap: 3, paddingVertical: spacing.xxs },
  accountDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.xs },
  accountTitleRow: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  accountStateDot: { width: 8, height: 8, borderRadius: 4 },
  accountName: { color: colors.text, ...typeScale.labelLarge },
  accountValue: { flexShrink: 0, color: colors.text, ...typeScale.labelLarge, fontVariant: ["tabular-nums"] },
  resetRow: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  relativeReset: { flexShrink: 0, color: colors.text, fontSize: 11, lineHeight: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  action: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm },
  dividedAction: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actionIcon: { width: 20, height: 20, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  actionTitle: { color: colors.text, ...typeScale.labelLarge },
  error: { color: colors.red, fontSize: 11, lineHeight: 15 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
