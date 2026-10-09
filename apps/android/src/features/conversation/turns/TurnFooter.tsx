/** V1 TurnFooter owner, extracted without changing interaction or resource lifetime. */
import type { TurnUsageProjection } from "@codewide/sync-client";
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
import { CostBreakdownMenu } from "../../accounts/CostBreakdownMenu";
import { styles } from "./TurnFooter.styles";

export const TURN_FOOTER_MIN_HEIGHT = 20;

export interface TurnFooterProps {
  readonly changesTarget?: TurnChangesTarget;
  readonly completedAt: number | null;
  readonly diff?: string;
  readonly durationMs: number | null;
  /** The model the turn ran on, when known; names the model in the unpriced-cost hint. */
  readonly model?: string | null;
  readonly status: "completed" | "interrupted" | "failed" | "inProgress";
  readonly usage?: TurnUsageProjection | null;
}

export function TurnFooter(props: TurnFooterProps) {
  const { completedAt, diff = "", durationMs, model = null, status, usage = null } = props;
  const tokenUsage = usage?.turn.tokens ?? null;
  const canOpenChanges = useContext(TurnChangesContext) !== null;
  return (
    <MessageFooterRow
      changes={
        canOpenChanges && diff.trim() !== "" && props.changesTarget !== undefined ? (
          <TurnChangesFooter diff={diff} target={props.changesTarget} />
        ) : null
      }
      cost={footerCost(usage, status, model)}
      time={completedAt === null ? null : formatClockTime(completedAt)}
      tokens={
        tokenUsage === null ? null : (
          <View
            accessibilityLabel={`${tokenUsage.inputTokens.toLocaleString()} input tokens, ${tokenUsage.outputTokens.toLocaleString()} output tokens`}
            accessible
            style={styles.turnTokenMetrics}
          >
            <Text numberOfLines={1} style={styles.turnMetaText}>
              {TOKEN_SYMBOL}
            </Text>
            {status === "inProgress" ? (
              <AnimatedNumber
                format={compactNumberFormat}
                prefix="↓"
                style={styles.turnMetaText}
                value={tokenUsage.inputTokens}
              />
            ) : (
              <Text numberOfLines={1} style={styles.turnMetaText}>
                ↓{compactNumber(tokenUsage.inputTokens)}
              </Text>
            )}
            {status === "inProgress" ? (
              <AnimatedNumber
                format={compactNumberFormat}
                prefix="↑"
                style={styles.turnMetaText}
                value={tokenUsage.outputTokens}
              />
            ) : (
              <Text numberOfLines={1} style={styles.turnMetaText}>
                ↑{compactNumber(tokenUsage.outputTokens)}
              </Text>
            )}
          </View>
        )
      }
    >
      <MessageFooterStatus>
        {status === "inProgress" ? (
          <CalmSpinner color={colors.textMuted} durationMs={3000} size={9} />
        ) : (
          <View
            accessibilityLabel={
              status === "completed" ? "Completed" : status === "interrupted" ? "Stopped" : "Failed"
            }
            accessible
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
          <Text numberOfLines={1} style={styles.turnMetaText} testID="running-turn-footer-label">
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

/**
 * The turn's estimated cost, or a hint that its usage is known but no price
 * is: hiding the cost silently would read as a free turn.
 */
function footerCost(
  usage: TurnUsageProjection | null,
  status: TurnFooterProps["status"],
  model: string | null,
): React.JSX.Element | null {
  if (usage === null) {
    return null;
  }
  if (usage.turn.cost !== null) {
    return <CostBreakdownMenu animated={status === "inProgress"} estimate={usage.turn.cost} />;
  }
  return (
    <Text
      accessibilityLabel={`Cost not available for ${model ?? "this model"}`}
      numberOfLines={1}
      style={styles.turnMetaText}
      testID="turn-cost-unavailable"
    >
      cost n/a
    </Text>
  );
}
