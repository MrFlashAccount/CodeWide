import { Popover } from "heroui-native/popover";
import { useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";

import { colors, radii, spacing, typeScale } from "../theme";
import { formatEstimatedTurnCost, type TokenCostEstimate } from "../turn-cost";
import { AnimatedNumber, integerNumberFormat, usdNumberFormat } from "./AnimatedNumber";
import { AppText as Text } from "./Typography";

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
      onPress={open ? undefined : () => setOpen(true)}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {animated
        ? <AnimatedNumber value={estimate.totalCostUsd} format={usdNumberFormat(estimate.totalCostUsd)} prefix="≈" style={styles.trigger} />
        : <Text style={styles.trigger}>≈{formatEstimatedTurnCost(estimate.totalCostUsd)}</Text>}
    </Pressable>
  );
  if (!open) return trigger;
  return (
    <Popover presentation="popover" isOpen onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Overlay className="bg-backdrop" />
        <Popover.Content
          presentation="popover"
          placement="top"
          align="end"
          offset={8}
          width={Math.max(1, Math.min(300, width - 24))}
          className="border border-border"
          style={styles.popover}
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
          <Popover.Arrow />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
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

export function AnimatedBreakdownRow({ label, value, format = integerNumberFormat, suffix }: { label: string; value: number; format?: Intl.NumberFormatOptions; suffix?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <AnimatedNumber value={value} format={format} {...(suffix === undefined ? {} : { suffix })} style={styles.rowValue} />
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
        <AnimatedNumber value={tokens} format={integerNumberFormat} style={styles.rowValue} />
        <Text style={styles.rowValue}>·</Text>
        <AnimatedNumber value={costUsd} format={usdNumberFormat(costUsd)} style={styles.rowValue} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  popover: { padding: 0, borderRadius: radii.large, overflow: "hidden" },
  content: { gap: spacing.xs, padding: spacing.sm },
  heading: { gap: 2 },
  title: { color: colors.text, ...typeScale.titleMedium, fontWeight: "700" },
  model: { color: colors.textDim, fontSize: 11, lineHeight: 15 },
  rows: { gap: 2 },
  row: { minHeight: 25, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  rowLabel: { flexShrink: 1, color: colors.textMuted, ...typeScale.bodyMedium },
  rowValue: { flexShrink: 0, color: colors.text, fontSize: 12, lineHeight: 17, fontVariant: ["tabular-nums"] },
  tokenCostValue: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 4 },
  totalRow: { minHeight: 30, marginTop: 3, paddingTop: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  totalLabel: { color: colors.text, ...typeScale.labelMedium },
  totalValue: { color: colors.text, ...typeScale.titleMedium, fontWeight: "700", fontVariant: ["tabular-nums"] },
  note: { color: colors.textDim, fontSize: 10, lineHeight: 14 },
  trigger: { color: colors.textMuted, fontSize: 10, lineHeight: 14, textDecorationLine: "underline", textDecorationStyle: "dotted" },
  pressed: { opacity: 0.68 },
});
