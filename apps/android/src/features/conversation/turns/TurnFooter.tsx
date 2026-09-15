/** V1 TurnFooter owner, extracted without changing interaction or resource lifetime. */
import { type TurnUsageProjection } from "@codewide/sync-client";
import { useContext } from "react";
import { View } from "react-native";
import { formatClockTime } from "../../../data/device-time";
import { MessageFooterRow, MessageFooterStatus } from "../../../rendering/MessageFooterRow";
import { TurnChangesContext, type TurnChangesTarget } from "../../../rendering/TurnChangesContext";
import { TurnChangesFooter } from "../../../rendering/TurnChangesFooter";
import { colors } from "../../../theme";
import { AnimatedNumber, compactNumberFormat } from "../../../ui/AnimatedNumber";
import { CalmSpinner } from "../../../ui/CalmSpinner";
import { compactNumber, formatDuration } from "../../../ui/number-format";
import { TOKEN_SYMBOL } from "../../../ui/token-display";
import { AppText as Text } from "../../../ui/Typography";
import { CostBreakdownPopover } from "../../accounts/CostBreakdownPopover";
import { styles } from "./TurnFooter.styles";

export const TURN_FOOTER_MIN_HEIGHT = 20;

export interface TurnFooterProps {
  readonly status: "completed" | "interrupted" | "failed" | "inProgress";
  readonly durationMs: number | null;
  readonly completedAt: number | null;
  readonly usage?: TurnUsageProjection | null;
  readonly diff?: string;
  readonly changesTarget?: TurnChangesTarget;
}

export function TurnFooter(props: TurnFooterProps) {
  const { status, durationMs, completedAt, usage = null, diff = "" } = props;
  const tokenUsage = usage?.turn.tokens ?? null;
  const estimatedCost = usage?.turn.cost ?? null;
  const canOpenChanges = useContext(TurnChangesContext) !== null;
  return (
    <MessageFooterRow
      time={completedAt === null ? null : formatClockTime(completedAt)}
      tokens={
        tokenUsage === null ? null : (
          <View
            accessible
            accessibilityLabel={`${tokenUsage.inputTokens.toLocaleString()} input tokens, ${tokenUsage.outputTokens.toLocaleString()} output tokens`}
            style={styles.turnTokenMetrics}
          >
            <Text numberOfLines={1} style={styles.turnMetaText}>
              {TOKEN_SYMBOL}
            </Text>
            {status === "inProgress" ? (
              <AnimatedNumber
                value={tokenUsage.inputTokens}
                format={compactNumberFormat}
                prefix="↓"
                style={styles.turnMetaText}
              />
            ) : (
              <Text numberOfLines={1} style={styles.turnMetaText}>
                ↓{compactNumber(tokenUsage.inputTokens)}
              </Text>
            )}
            {status === "inProgress" ? (
              <AnimatedNumber
                value={tokenUsage.outputTokens}
                format={compactNumberFormat}
                prefix="↑"
                style={styles.turnMetaText}
              />
            ) : (
              <Text numberOfLines={1} style={styles.turnMetaText}>
                ↑{compactNumber(tokenUsage.outputTokens)}
              </Text>
            )}
          </View>
        )
      }
      cost={
        estimatedCost === null ? null : (
          <CostBreakdownPopover estimate={estimatedCost} animated={status === "inProgress"} />
        )
      }
      changes={
        canOpenChanges && diff.trim() !== "" && props.changesTarget !== undefined ? (
          <TurnChangesFooter diff={diff} target={props.changesTarget} />
        ) : null
      }
    >
      <MessageFooterStatus>
        {status === "inProgress" ? (
          <CalmSpinner size={9} color={colors.textMuted} durationMs={3_000} />
        ) : (
          <View
            accessible
            accessibilityLabel={
              status === "completed" ? "Completed" : status === "interrupted" ? "Stopped" : "Failed"
            }
            style={[
              styles.turnStatusDot,
              status === "failed"
                ? styles.turnStatusFailed
                : status === "interrupted"
                  ? styles.turnStatusStopped
                  : styles.turnStatusCompleted,
            ]}
          />
        )}
        {status === "inProgress" ? (
          <Text numberOfLines={1} testID="running-turn-footer-label" style={styles.turnMetaText}>
            Running
          </Text>
        ) : status === "completed" ? null : (
          <Text numberOfLines={1} style={styles.turnMetaText}>
            {status === "interrupted" ? "Stopped" : "Failed"}
          </Text>
        )}
      </MessageFooterStatus>
      {durationMs !== null && (
        <Text numberOfLines={1} style={styles.turnMetaText}>
          {formatDuration(durationMs)}
        </Text>
      )}
    </MessageFooterRow>
  );
}
