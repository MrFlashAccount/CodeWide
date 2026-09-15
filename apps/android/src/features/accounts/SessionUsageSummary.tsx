import type { TurnUsageProjection } from "@codewide/sync-client";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";

import { colors, iconSize } from "../../theme";
import { formatEstimatedTurnCost } from "../../turn-cost";
import { AnimatedNumber, compactNumberFormat, usdNumberFormat } from "../../ui/AnimatedNumber";
import { AppText as Text } from "../../ui/Typography";
import { TOKEN_SYMBOL } from "../../ui/token-display";
import { SessionUsageDetails } from "./SessionUsageDetails";

import { styles } from "./UsagePopover.styles";

export function SessionUsageSummary({
  sessionUsage,
  sessionCost,
  compactionCount,
  sessionExpanded,
  setSessionExpanded,
}: {
  sessionUsage: TurnUsageProjection["thread"]["tokens"] | null;
  sessionCost: TurnUsageProjection["thread"]["cost"] | null;
  compactionCount: number | null | undefined;
  sessionExpanded: boolean;
  setSessionExpanded(update: (expanded: boolean) => boolean): void;
}) {
  const sessionAccessibilityLabel = [
    sessionUsage === null
      ? "token usage unavailable"
      : `${sessionUsage.totalTokens.toLocaleString()} tokens`,
    sessionCost === null
      ? "cost unavailable"
      : `estimated cost ${formatEstimatedTurnCost(sessionCost.totalCostUsd)}`,
  ].join(", ");
  return (
    <View testID="usage-session-section" style={[styles.section, styles.dividedSection]}>
      <Pressable
        testID="usage-session-summary"
        accessibilityRole="button"
        accessibilityLabel={`Session usage, ${sessionAccessibilityLabel}`}
        accessibilityHint={
          sessionExpanded
            ? "Hides the token and cost breakdown"
            : "Shows the token and cost breakdown"
        }
        accessibilityState={{ expanded: sessionExpanded }}
        hitSlop={4}
        onPress={() => setSessionExpanded((expanded) => !expanded)}
        style={({ pressed }) => [styles.sessionSummaryRow, pressed && styles.pressed]}
      >
        <Ionicons name="analytics-outline" size={iconSize.inline} color={colors.textMuted} />
        <Text style={styles.title}>Session</Text>
        <View style={styles.sessionSummaryValues}>
          {sessionUsage !== null && (
            <AnimatedNumber
              value={sessionUsage.totalTokens}
              format={compactNumberFormat}
              prefix={TOKEN_SYMBOL}
              style={styles.sessionSummaryText}
              testID="usage-session-tokens"
            />
          )}
          {sessionUsage !== null && sessionCost !== null && (
            <Text style={styles.sessionSummarySeparator}>·</Text>
          )}
          {sessionCost !== null && (
            <AnimatedNumber
              value={sessionCost.totalCostUsd}
              format={usdNumberFormat(sessionCost.totalCostUsd)}
              prefix="≈"
              style={styles.sessionCostText}
              testID="usage-session-cost"
            />
          )}
          {sessionUsage === null && sessionCost === null && (
            <Text numberOfLines={1} style={styles.sessionSummaryText}>
              Unavailable
            </Text>
          )}
        </View>
        <Ionicons
          name={sessionExpanded ? "chevron-up" : "chevron-down"}
          size={iconSize.inline}
          color={colors.textDim}
        />
      </Pressable>
      {sessionExpanded && (
        <SessionUsageDetails
          tokens={
            sessionUsage === null
              ? null
              : {
                  input: sessionUsage.inputTokens,
                  cached: sessionUsage.cachedInputTokens,
                  output: sessionUsage.outputTokens,
                  total: sessionUsage.totalTokens,
                }
          }
          cost={
            sessionCost === null
              ? null
              : {
                  input:
                    sessionCost.uncachedInputCostUsd +
                    sessionCost.cachedInputCostUsd +
                    sessionCost.cacheWriteInputCostUsd,
                  cached: sessionCost.cachedInputCostUsd,
                  output: sessionCost.outputCostUsd,
                  total: sessionCost.totalCostUsd,
                }
          }
          compactionCount={compactionCount ?? null}
        />
      )}
    </View>
  );
}
