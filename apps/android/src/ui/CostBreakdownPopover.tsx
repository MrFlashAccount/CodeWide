import { AppPopover } from "./AppPopover";
import { useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";

import { colors, spacing, typeScale, typeWeight, controlSize } from "../theme";
import { formatEstimatedTurnCost, type TokenCostEstimate } from "../turn-cost";
import { AnimatedNumber, integerNumberFormat, usdNumberFormat } from "./AnimatedNumber";
import { AppText as Text } from "./Typography";
import { TOKEN_SYMBOL } from "./token-display";

export function CostBreakdownPopover({ estimate, animated = false }: { estimate: TokenCostEstimate; animated?: boolean }) {
  const [open, setOpen] = useState(false);
  const { width } = useWindowDimensions();
  const label = `Estimated API-equivalent cost ${formatEstimatedTurnCost(estimate.totalCostUsd)}`;
  const trigger = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Shows the token cost breakdown"
      hitSlop={5}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {animated
        ? <AnimatedNumber value={estimate.totalCostUsd} format={usdNumberFormat(estimate.totalCostUsd)} prefix="≈" style={styles.trigger} />
        : <Text numberOfLines={1} style={styles.trigger}>≈{formatEstimatedTurnCost(estimate.totalCostUsd)}</Text>}
    </Pressable>
  );
  return (
    <AppPopover open={open} onOpenChange={setOpen} trigger={trigger}
          placement="top"
          align="end"
          width={Math.max(1, Math.min(300, width - 24))}
        >
          <View testID="turn-cost-breakdown" style={styles.content}>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>Cost breakdown</Text>
              <Text numberOfLines={1} style={styles.model}>{estimate.model}</Text>
            </View>
            <TokenCostRows estimate={estimate} />
            <Text style={styles.note}>
              API-equivalent estimate computed by the companion from per-request usage · {estimate.pricingVersion}
            </Text>
          </View>
    </AppPopover>
  );
}

export function TokenCostRows({ estimate }: { estimate: TokenCostEstimate }) {
  return (
    <View style={styles.rows}>
      <TokenCostRow label="Input" tokens={estimate.uncachedInputTokens} costUsd={estimate.uncachedInputCostUsd} />
      <TokenCostRow label="Cached input" tokens={estimate.cachedInputTokens} costUsd={estimate.cachedInputCostUsd} />
      {estimate.cacheWriteInputTokens > 0 && <TokenCostRow label="Cache write" tokens={estimate.cacheWriteInputTokens} costUsd={estimate.cacheWriteInputCostUsd} />}
      <TokenCostRow label="Output" tokens={estimate.outputTokens} costUsd={estimate.outputCostUsd} />
      <AnimatedBreakdownRow label="Cache hit" value={estimate.cacheHitPercent} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} suffix="%" />
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Estimated total</Text>
        <AnimatedNumber value={estimate.totalCostUsd} format={usdNumberFormat(estimate.totalCostUsd)} style={styles.totalValue} />
      </View>
    </View>
  );
}

export function AnimatedBreakdownRow({ label, value, format = integerNumberFormat, prefix, suffix }: { label: string; value: number; format?: Intl.NumberFormatOptions; prefix?: string; suffix?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <AnimatedNumber value={value} format={format} {...(prefix === undefined ? {} : { prefix })} {...(suffix === undefined ? {} : { suffix })} style={styles.rowValue} />
    </View>
  );
}

export function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function TokenCostRow({ label, tokens, costUsd }: { label: string; tokens: number; costUsd: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.tokenCostValue}>
        <AnimatedNumber value={tokens} format={integerNumberFormat} prefix={TOKEN_SYMBOL} style={styles.rowValue} />
        <Text style={styles.rowValue}>·</Text>
        <AnimatedNumber value={costUsd} format={usdNumberFormat(costUsd)} style={styles.rowValue} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xs, padding: spacing.sm },
  heading: { gap: spacing.optical },
  title: { color: colors.text, ...typeScale.title, fontWeight: typeWeight.semibold },
  model: { color: colors.textDim, ...typeScale.label, },
  rows: { gap: spacing.optical },
  row: { minHeight: controlSize.compact, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  rowLabel: { flexShrink: 1, color: colors.textMuted, ...typeScale.body },
  rowValue: { flexShrink: 0, color: colors.text, ...typeScale.label, fontVariant: ["tabular-nums"] },
  tokenCostValue: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  totalRow: { minHeight: controlSize.compact, marginTop: spacing.xxs, paddingTop: spacing.xxs, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  totalLabel: { color: colors.text, ...typeScale.label },
  totalValue: { color: colors.text, ...typeScale.title, fontWeight: typeWeight.semibold, fontVariant: ["tabular-nums"] },
  note: { color: colors.textDim, ...typeScale.caption, },
  trigger: { color: colors.textMuted, ...typeScale.caption, },
  pressed: { opacity: 0.68 },
});
