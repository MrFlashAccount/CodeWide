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

interface SessionUsageDetailsProps {
  readonly compactionCount: number | null;
  readonly cost: {
    readonly cached: number;
    readonly input: number;
    readonly output: number;
    readonly total: number;
  } | null;
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
          <SessionUsageRow cost={cost?.input ?? null} label="Input" tokens={tokens.input} />
          <SessionUsageRow cost={cost?.cached ?? null} label="Cached" tokens={tokens.cached} />
          <SessionUsageRow cost={cost?.output ?? null} label="Output" tokens={tokens.output} />
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
            <Text style={[styles.caption, styles.explanationLabel]}>
              API estimate · current model prices
            </Text>
            <Ionicons
              color={colors.textDim}
              name={explanationOpen ? "chevron-up" : "chevron-down"}
              size={iconSize.indicator}
            />
          </Pressable>
          {explanationOpen && (
            <Text style={styles.caption}>
              Estimated API-equivalent cost, not an account charge. Model switches and per-request
              long-context premiums are not reconstructed.
            </Text>
          )}
        </>
      )}
    </View>
  );
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
