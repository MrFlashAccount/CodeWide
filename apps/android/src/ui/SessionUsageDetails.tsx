import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, controlSize, iconSize, spacing, typeScale, typeWeight } from "../theme";
import { AnimatedNumber, compactNumberFormat, integerNumberFormat, usdNumberFormat } from "./AnimatedNumber";
import { AppText as Text } from "./Typography";

interface SessionUsageDetailsProps {
  readonly tokens: {
    readonly input: number;
    readonly cached: number;
    readonly output: number;
    readonly total: number;
  } | null;
  readonly cost: {
    readonly input: number;
    readonly cached: number;
    readonly output: number;
    readonly total: number;
  } | null;
  readonly compactionCount: number | null;
}

export function SessionUsageDetails({ tokens, cost, compactionCount }: SessionUsageDetailsProps) {
  const [explanationOpen, setExplanationOpen] = useState(false);
  return <View testID="usage-session-details" style={styles.content}>
    {tokens === null ? <Text style={styles.label}>Token usage unavailable</Text> : <>
      <View style={styles.heading}>
        <View style={styles.labelColumn} />
        <Text style={[styles.columnHeading, styles.numberColumn]}>Tokens</Text>
        <Text style={[styles.columnHeading, styles.numberColumn]}>Est. cost</Text>
      </View>
      <SessionUsageRow label="Input" tokens={tokens.input} cost={cost?.input ?? null} />
      <SessionUsageRow label="Cached" tokens={tokens.cached} cost={cost?.cached ?? null} />
      <SessionUsageRow label="Output" tokens={tokens.output} cost={cost?.output ?? null} />
      <SessionUsageRow label="Total" tokens={tokens.total} cost={cost?.total ?? null} total />
    </>}
    <View style={styles.compactions}>
      <Text style={styles.caption}>Compactions</Text>
      {compactionCount === null
        ? <Text accessibilityLabel="Compaction count unavailable: history not loaded" style={styles.caption}>Not loaded</Text>
        : <AnimatedNumber value={compactionCount} format={integerNumberFormat} accessibilityLabel={`${compactionCount} compactions`} style={styles.caption} />}
    </View>
    {cost === null ? <Text style={styles.caption}>Cost unavailable for the current model.</Text> : <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="About the cost estimate"
        accessibilityState={{ expanded: explanationOpen }}
        onPress={() => setExplanationOpen(!explanationOpen)}
        style={({ pressed }) => [styles.explanationButton, pressed && styles.pressed]}
      >
        <Ionicons name="information-circle-outline" size={iconSize.inline} color={colors.textDim} />
        <Text style={[styles.caption, styles.explanationLabel]}>API estimate · current model prices</Text>
        <Ionicons name={explanationOpen ? "chevron-up" : "chevron-down"} size={iconSize.indicator} color={colors.textDim} />
      </Pressable>
      {explanationOpen && <Text style={styles.caption}>Estimated API-equivalent cost, not an account charge. Model switches and per-request long-context premiums are not reconstructed.</Text>}
    </>}
  </View>;
}

function SessionUsageRow({ label, tokens, cost, total = false }: { label: string; tokens: number; cost: number | null; total?: boolean }) {
  return <View style={[styles.row, total && styles.total]}>
    <Text style={[styles.label, styles.labelColumn, total && styles.emphasized]}>{label}</Text>
    <AnimatedNumber
      value={tokens} format={compactNumberFormat}
      accessibilityLabel={`${label}: ${tokens.toLocaleString()} tokens`}
      containerStyle={styles.numberColumn} style={[styles.value, total && styles.emphasized]}
    />
    {cost === null ? <Text accessibilityLabel={`${label} cost unavailable`} style={[styles.value, styles.numberColumn]}>—</Text>
      : <AnimatedNumber value={cost} format={usdNumberFormat(cost)} containerStyle={styles.numberColumn} style={[styles.value, total && styles.emphasized]} />}
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.optical, paddingBottom: spacing.xxs },
  heading: { flexDirection: "row", gap: spacing.xs, paddingVertical: spacing.xxs },
  row: { flexDirection: "row", alignItems: "center", minHeight: controlSize.compact, gap: spacing.xs },
  labelColumn: { flex: 1, minWidth: 0 },
  numberColumn: { flex: 1, minWidth: 0, alignSelf: "center", textAlign: "right" },
  columnHeading: { ...typeScale.caption, color: colors.textDim },
  label: { ...typeScale.label, color: colors.textMuted },
  value: { ...typeScale.label, color: colors.text, textAlign: "right", fontVariant: ["tabular-nums"] },
  total: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing.xxs, paddingTop: spacing.xxs },
  emphasized: { color: colors.text, fontWeight: typeWeight.semibold },
  compactions: { flexDirection: "row", justifyContent: "space-between", gap: spacing.xs, paddingVertical: spacing.xs },
  caption: { ...typeScale.caption, color: colors.textDim },
  explanationButton: { flexDirection: "row", alignItems: "center", gap: spacing.xxs, minHeight: controlSize.regular },
  explanationLabel: { flex: 1 },
  pressed: { opacity: 0.7 },
});
