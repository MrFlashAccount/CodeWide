import type { TurnUsageProjection } from "@codewide/sync-client";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";

import { colors, iconSize } from "../../theme";
import { formatEstimatedTurnCost } from "../../turn-cost";
import { AnimatedNumber, compactNumberFormat, usdNumberFormat } from "../../ui/AnimatedNumber";
import { AppText as Text } from "../../ui/Typography";
import { TOKEN_SYMBOL } from "../../ui/token-display";
import { SessionUsageDetails } from "./SessionUsageDetails";

import { styles } from "./UsageMenu.styles";

export function SessionUsageSummary({
  compactionCount,
  sessionCost,
  sessionExpanded,
  sessionUsage,
  setSessionExpanded,
}: {
  compactionCount: number | null | undefined;
  sessionCost: TurnUsageProjection["thread"]["cost"] | null;
  sessionExpanded: boolean;
  sessionUsage: TurnUsageProjection["thread"]["tokens"] | null;
  setSessionExpanded: (update: (expanded: boolean) => boolean) => void;
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
    <View style={[styles.section, styles.dividedSection]} testID="usage-session-section">
      <Pressable
        accessibilityHint={
          sessionExpanded
            ? "Hides the token and cost breakdown"
            : "Shows the token and cost breakdown"
        }
        accessibilityLabel={`Session usage, ${sessionAccessibilityLabel}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: sessionExpanded }}
        hitSlop={4}
        onPress={() => {
          setSessionExpanded((expanded) => !expanded);
        }}
        style={({ pressed }) => [styles.sessionSummaryRow, pressed && styles.pressed]}
        testID="usage-session-summary"
      >
        <Ionicons color={colors.textMuted} name="analytics-outline" size={iconSize.inline} />
        <Text style={styles.title}>Session</Text>
        <View style={styles.sessionSummaryValues}>
          {sessionUsage !== null && (
            <AnimatedNumber
              format={compactNumberFormat}
              prefix={TOKEN_SYMBOL}
              style={styles.sessionSummaryText}
              testID="usage-session-tokens"
              value={sessionUsage.totalTokens}
            />
          )}
          {sessionUsage !== null && sessionCost !== null && (
            <Text style={styles.sessionSummarySeparator}>·</Text>
          )}
          {sessionCost !== null && (
            <AnimatedNumber
              format={usdNumberFormat(sessionCost.totalCostUsd)}
              prefix="≈"
              style={styles.sessionCostText}
              testID="usage-session-cost"
              value={sessionCost.totalCostUsd}
            />
          )}
          {sessionUsage === null && sessionCost === null && (
            <Text numberOfLines={1} style={styles.sessionSummaryText}>
              Unavailable
            </Text>
          )}
        </View>
        <Ionicons
          color={colors.textDim}
          name={sessionExpanded ? "chevron-up" : "chevron-down"}
          size={iconSize.inline}
        />
      </Pressable>
      {sessionExpanded && (
        <SessionUsageDetails
          compactionCount={compactionCount ?? null}
          cost={
            sessionCost === null
              ? null
              : {
                  cached: sessionCost.cachedInputCostUsd,
                  input:
                    sessionCost.uncachedInputCostUsd +
                    sessionCost.cachedInputCostUsd +
                    sessionCost.cacheWriteInputCostUsd,
                  output: sessionCost.outputCostUsd,
                  total: sessionCost.totalCostUsd,
                }
          }
          tokens={
            sessionUsage === null
              ? null
              : {
                  cached: sessionUsage.cachedInputTokens,
                  input: sessionUsage.inputTokens,
                  output: sessionUsage.outputTokens,
                  total: sessionUsage.totalTokens,
                }
          }
        />
      )}
    </View>
  );
}
