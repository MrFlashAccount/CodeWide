import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { TurnUsageProjection } from "@codewide/sync-client";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactElement } from "react";
import { Pressable, View, useWindowDimensions, type PressableProps } from "react-native";
import { AppPopover } from "../../ui/AppPopover";
import { renderContextRingView } from "./ContextRingView";
import { SessionUsageSummary } from "./SessionUsageSummary";
import { styles } from "./UsagePopover.styles";
import { AccountUsageSection } from "./accountUsage";

import {
  accountRateLimitsStale,
  contextUsageFromProjection,
  currentThreadUsageProjection,
} from "../../data/account-rate-limits";
import { type AccountUsageSource } from "../../data/account-usage-presentation";
import { colors, iconSize } from "../../theme";
import { AnimatedNumber, compactNumberFormat } from "../../ui/AnimatedNumber";
import { AppText as Text } from "../../ui/Typography";
import { TOKEN_SYMBOL } from "../../ui/token-display";

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
  const usageProjection =
    currentUsage === undefined ? currentThreadUsageProjection(thread) : currentUsage;
  const context = contextUsageFromProjection(usageProjection);
  const sessionUsage = usageProjection?.thread.tokens ?? null;
  const sessionCost = usageProjection?.thread.cost ?? null;
  const contentWidth = Math.max(1, Math.min(312, width - 24));
  const hasLeadingSection = thread !== undefined || accountSources !== undefined;
  const openChanged = (open: boolean) => {
    setOpen(open);
    if (!open) setSessionExpanded(false);
    if (
      open &&
      accountSources?.some((source) => accountRateLimitsStale(source.rateLimits)) === true &&
      onRefresh !== undefined
    )
      void onRefresh().catch(() => undefined);
  };

  return (
    <AppPopover
      open={open}
      onOpenChange={openChanged}
      trigger={children}
      width={contentWidth}
      placement={placement}
      align={align}
    >
      <View testID="usage-popover" style={styles.content}>
        {thread !== undefined && (
          <View testID="usage-context-section" style={styles.section}>
            <Text accessibilityRole="header" style={styles.title}>
              Context
            </Text>
            <View style={styles.contextSummary}>
              <ContextRing
                percent={context?.usedPercent ?? 0}
                size={46}
                showValue={context !== null}
              />
              <View style={styles.grow}>
                {context === null ? (
                  <Text numberOfLines={1} style={[styles.primaryValue, styles.unavailable]}>
                    Usage unavailable
                  </Text>
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
                  <Text numberOfLines={1} style={styles.secondaryValue}>
                    No token data for this thread
                  </Text>
                ) : (
                  <AnimatedNumber
                    value={context.remainingTokens}
                    format={compactNumberFormat}
                    prefix={TOKEN_SYMBOL}
                    suffix=" available"
                    style={styles.secondaryValue}
                  />
                )}
              </View>
            </View>
          </View>
        )}

        <AccountUsageSection accountSources={accountSources} hasContext={thread !== undefined} />

        {thread !== undefined && (
          <SessionUsageSummary
            sessionUsage={sessionUsage}
            sessionCost={sessionCost}
            compactionCount={compactionCount}
            sessionExpanded={sessionExpanded}
            setSessionExpanded={setSessionExpanded}
          />
        )}

        {actions.map((action, index) => (
          <Pressable
            key={action.id}
            accessibilityRole="button"
            accessibilityLabel={
              action.description === undefined
                ? action.label
                : `${action.label}, ${action.description}`
            }
            onPress={() => {
              setOpen(false);
              action.onPress();
            }}
            style={({ pressed }) => [
              styles.action,
              hasLeadingSection && index === 0 && styles.dividedAction,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.actionIcon}>
              <Ionicons name={action.icon} size={iconSize.action} color={colors.textMuted} />
            </View>
            <View style={styles.grow}>
              <Text style={styles.actionTitle}>{action.label}</Text>
              {action.description !== undefined && (
                <Text numberOfLines={1} style={styles.meta}>
                  {action.description}
                </Text>
              )}
            </View>
          </Pressable>
        ))}
      </View>
    </AppPopover>
  );
}

export function ContextRing({
  percent,
  size = 22,
  showValue = false,
}: {
  percent: number;
  size?: number;
  showValue?: boolean;
}) {
  const strokeWidth = Math.max(2, size * 0.12);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, percent));
  return renderContextRingView({ progress, size, radius, strokeWidth, circumference, showValue });
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}
