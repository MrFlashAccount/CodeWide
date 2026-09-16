import { createElement, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { ContentMenu } from "../../ui/ContentMenu";

import { useEvent } from "../../react/useEvent";
import { colors, controlSize, spacing, typeScale, typeWeight } from "../../theme";
import { formatEstimatedTurnCost, type TokenCostEstimate } from "../../turn-cost";
import { AnimatedNumber, integerNumberFormat, usdNumberFormat } from "../../ui/AnimatedNumber";
import { AppText as Text } from "../../ui/Typography";
import { TOKEN_SYMBOL } from "../../ui/token-display";

const MENU_MIN_WIDTH = 1;
const MENU_MAX_WIDTH = 300;
const MENU_WINDOW_GUTTER = 24;
const PRESSED_OPACITY = 0.68;

export function CostBreakdownMenu({
  animated = false,
  estimate,
}: {
  animated?: boolean;
  estimate: TokenCostEstimate;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { width } = useWindowDimensions();
  const toggleOpen = useEvent(() => {
    setOpen((current) => !current);
  });
  const label = `Estimated API-equivalent cost ${formatEstimatedTurnCost(estimate.totalCostUsd)}`;
  const trigger = createElement(CostBreakdownTrigger, {
    animated,
    estimate,
    label,
    onPress: toggleOpen,
  });
  return (
    <ContentMenu
      align="end"
      onOpenChange={setOpen}
      open={open}
      placement="top"
      trigger={trigger}
      width={Math.max(MENU_MIN_WIDTH, Math.min(MENU_MAX_WIDTH, width - MENU_WINDOW_GUTTER))}
    >
      <CostBreakdownContent estimate={estimate} />
    </ContentMenu>
  );
}

function CostBreakdownContent({
  estimate,
}: {
  readonly estimate: TokenCostEstimate;
}): React.JSX.Element {
  return (
    <View style={styles.content} testID="turn-cost-breakdown">
      <CostBreakdownHeading model={estimate.model} />
      <TokenCostRows estimate={estimate} />
      <Text style={styles.note}>
        API-equivalent estimate computed by the companion from per-request usage ·{" "}
        {estimate.pricingVersion}
      </Text>
    </View>
  );
}

function CostBreakdownHeading({ model }: { readonly model: string }): React.JSX.Element {
  return (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>
        Cost breakdown
      </Text>
      <Text numberOfLines={1} style={styles.model}>
        {model}
      </Text>
    </View>
  );
}

function CostBreakdownTrigger({
  animated,
  estimate,
  label,
  onPress,
}: {
  readonly animated: boolean;
  readonly estimate: TokenCostEstimate;
  readonly label: string;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityHint="Shows the token cost breakdown"
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={5}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {animated ? (
        <AnimatedNumber
          format={usdNumberFormat(estimate.totalCostUsd)}
          prefix="≈"
          style={styles.trigger}
          value={estimate.totalCostUsd}
        />
      ) : (
        <Text numberOfLines={1} style={styles.trigger}>
          ≈{formatEstimatedTurnCost(estimate.totalCostUsd)}
        </Text>
      )}
    </Pressable>
  );
}

function TokenCostRows({ estimate }: { readonly estimate: TokenCostEstimate }): React.JSX.Element {
  return (
    <View style={styles.rows}>
      <TokenCostRow
        costUsd={estimate.uncachedInputCostUsd}
        label="Input"
        tokens={estimate.uncachedInputTokens}
      />
      <TokenCostRow
        costUsd={estimate.cachedInputCostUsd}
        label="Cached input"
        tokens={estimate.cachedInputTokens}
      />
      {estimate.cacheWriteInputTokens > 0 && (
        <TokenCostRow
          costUsd={estimate.cacheWriteInputCostUsd}
          label="Cache write"
          tokens={estimate.cacheWriteInputTokens}
        />
      )}
      <TokenCostRow
        costUsd={estimate.outputCostUsd}
        label="Output"
        tokens={estimate.outputTokens}
      />
      <AnimatedBreakdownRow
        format={{ maximumFractionDigits: 1, minimumFractionDigits: 1 }}
        label="Cache hit"
        suffix="%"
        value={estimate.cacheHitPercent}
      />
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Estimated total</Text>
        <AnimatedNumber
          format={usdNumberFormat(estimate.totalCostUsd)}
          style={styles.totalValue}
          value={estimate.totalCostUsd}
        />
      </View>
    </View>
  );
}

function AnimatedBreakdownRow({
  format = integerNumberFormat,
  label,
  prefix,
  suffix,
  value,
}: {
  format?: Intl.NumberFormatOptions;
  label: string;
  prefix?: string;
  suffix?: string;
  value: number;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <AnimatedNumber
        format={format}
        value={value}
        {...(prefix === undefined ? {} : { prefix })}
        {...(suffix === undefined ? {} : { suffix })}
        style={styles.rowValue}
      />
    </View>
  );
}

function TokenCostRow({
  costUsd,
  label,
  tokens,
}: {
  costUsd: number;
  label: string;
  tokens: number;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.tokenCostValue}>
        <AnimatedNumber
          format={integerNumberFormat}
          prefix={TOKEN_SYMBOL}
          style={styles.rowValue}
          value={tokens}
        />
        <Text style={styles.rowValue}>·</Text>
        <AnimatedNumber format={usdNumberFormat(costUsd)} style={styles.rowValue} value={costUsd} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xs,
    padding: spacing.sm,
  },
  heading: { gap: spacing.optical },
  model: {
    color: colors.textDim,
    ...typeScale.label,
  },
  note: {
    color: colors.textDim,
    ...typeScale.caption,
  },
  pressed: { opacity: PRESSED_OPACITY },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: controlSize.compact,
  },
  rowLabel: {
    color: colors.textMuted,
    flexShrink: 1,
    ...typeScale.body,
  },
  rows: { gap: spacing.optical },
  rowValue: {
    color: colors.text,
    flexShrink: 0,
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
  },
  title: {
    color: colors.text,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
  tokenCostValue: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: spacing.xxs,
  },
  totalLabel: {
    color: colors.text,
    ...typeScale.label,
  },
  totalRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    marginTop: spacing.xxs,
    minHeight: controlSize.compact,
    paddingTop: spacing.xxs,
  },
  totalValue: {
    color: colors.text,
    ...typeScale.title,
    fontVariant: ["tabular-nums"],
    fontWeight: typeWeight.semibold,
  },
  trigger: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
});
