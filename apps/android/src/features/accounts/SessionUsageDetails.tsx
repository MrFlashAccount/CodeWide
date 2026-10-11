import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, controlSize, iconSize, spacing, typeScale, typeWeight } from "../../theme";
import {
  AnimatedNumber,
  compactNumberFormat,
  integerNumberFormat,
  usdNumberFormat,
} from "../../ui/AnimatedNumber";
import { AppText as Text } from "../../ui/Typography";

/**
 * The session's estimated cost: an API-equivalent estimate per token kind, or
 * a total the agent reported from its list prices or organization rates.
 */
export type SessionCostDetails =
  | {
      readonly basis: "apiEquivalent";
      readonly cached: number;
      readonly input: number;
      readonly output: number;
      readonly total: number;
    }
  | {
      readonly basis: "providerReported";
      readonly prices: "list" | "managed";
      readonly total: number;
    };

interface SessionUsageDetailsProps {
  readonly compactionCount: number | null;
  readonly cost: SessionCostDetails | null;
  readonly tokens: {
    readonly cached: number;
    readonly input: number;
    readonly output: number;
    readonly total: number;
  } | null;
}

export function SessionUsageDetails({ compactionCount, cost, tokens }: SessionUsageDetailsProps) {
  const [explanationOpen, setExplanationOpen] = useState(false);
  return (
    <View style={styles.content} testID="usage-session-details">
      {tokens === null ? (
        <Text style={styles.label}>Token usage unavailable</Text>
      ) : (
        <>
          <View style={styles.heading}>
            <View style={styles.labelColumn} />
            <Text style={[styles.columnHeading, styles.numberColumn]}>Tokens</Text>
            <Text style={[styles.columnHeading, styles.numberColumn]}>Est. cost</Text>
          </View>
          <SessionUsageRow cost={rowCost(cost, "input")} label="Input" tokens={tokens.input} />
          <SessionUsageRow cost={rowCost(cost, "cached")} label="Cached" tokens={tokens.cached} />
          <SessionUsageRow cost={rowCost(cost, "output")} label="Output" tokens={tokens.output} />
          <SessionUsageRow cost={cost?.total ?? null} label="Total" tokens={tokens.total} total />
        </>
      )}
      <View style={styles.compactions}>
        <Text style={styles.caption}>Compactions</Text>
        {compactionCount === null ? (
          <Text
            accessibilityLabel="Compaction count unavailable: history not loaded"
            style={styles.caption}
          >
            Not loaded
          </Text>
        ) : (
          <AnimatedNumber
            accessibilityLabel={`${String(compactionCount)} compactions`}
            format={integerNumberFormat}
            style={styles.caption}
            value={compactionCount}
          />
        )}
      </View>
      {cost === null ? (
        <Text style={styles.caption}>Cost unavailable for the current model.</Text>
      ) : (
        <>
          <Pressable
            accessibilityLabel="About the cost estimate"
            accessibilityRole="button"
            accessibilityState={{ expanded: explanationOpen }}
            onPress={() => {
              setExplanationOpen(!explanationOpen);
            }}
            style={({ pressed }) => [styles.explanationButton, pressed && styles.pressed]}
          >
            <Ionicons
              color={colors.textDim}
              name="information-circle-outline"
              size={iconSize.inline}
            />
            <Text style={[styles.caption, styles.explanationLabel]}>{costLabel(cost)}</Text>
            <Ionicons
              color={colors.textDim}
              name={explanationOpen ? "chevron-up" : "chevron-down"}
              size={iconSize.indicator}
            />
          </Pressable>
          {explanationOpen && <Text style={styles.caption}>{costExplanation(cost)}</Text>}
        </>
      )}
    </View>
  );
}

/** A per-kind cost: an agent-reported estimate has only its total. */
function rowCost(
  cost: SessionCostDetails | null,
  kind: "cached" | "input" | "output",
): number | null {
  return cost?.basis === "apiEquivalent" ? cost[kind] : null;
}

function costLabel(cost: SessionCostDetails): string {
  if (cost.basis === "apiEquivalent") {
    return "API estimate · current model prices";
  }
  return cost.prices === "managed"
    ? "Agent estimate · organization rates"
    : "Agent estimate · list prices";
}

function costExplanation(cost: SessionCostDetails): string {
  return cost.basis === "apiEquivalent"
    ? "Estimated API-equivalent cost, not an account charge. Model switches and per-request long-context premiums are not reconstructed."
    : "Estimated by the agent for every model it used, not an account charge. Only the total is known.";
}

function SessionUsageRow({
  cost,
  label,
  tokens,
  total = false,
}: {
  cost: number | null;
  label: string;
  tokens: number;
  total?: boolean;
}) {
  return (
    <View style={[styles.row, total && styles.total]}>
      <Text style={[styles.label, styles.labelColumn, total && styles.emphasized]}>{label}</Text>
      <AnimatedNumber
        accessibilityLabel={`${label}: ${tokens.toLocaleString()} tokens`}
        containerStyle={styles.numberColumn}
        format={compactNumberFormat}
        style={[styles.value, total && styles.emphasized]}
        value={tokens}
      />
      {cost === null ? (
        <Text
          accessibilityLabel={`${label} cost unavailable`}
          style={[styles.value, styles.numberColumn]}
        >
          —
        </Text>
      ) : (
        <AnimatedNumber
          containerStyle={styles.numberColumn}
          format={usdNumberFormat(cost)}
          style={[styles.value, total && styles.emphasized]}
          value={cost}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  caption: {
    ...typeScale.caption,
    color: colors.textDim,
  },
  columnHeading: {
    ...typeScale.caption,
    color: colors.textDim,
  },
  compactions: {
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  content: {
    gap: spacing.optical,
    paddingBottom: spacing.xxs,
  },
  emphasized: {
    color: colors.text,
    fontWeight: typeWeight.semibold,
  },
  explanationButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: controlSize.regular,
  },
  explanationLabel: { flex: 1 },
  heading: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  label: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  labelColumn: {
    flex: 1,
    minWidth: 0,
  },
  numberColumn: {
    alignSelf: "center",
    flex: 1,
    minWidth: 0,
    textAlign: "right",
  },
  pressed: { opacity: 0.7 },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.compact,
  },
  total: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xxs,
    paddingTop: spacing.xxs,
  },
  value: {
    ...typeScale.label,
    color: colors.text,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
});
