import { StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { formatUsageCost, formatUsageTokens } from "./usageFormat";
import type { UsageBreakdownViewModel } from "./usageTypes";

interface CostBreakdownContentProps {
  breakdown: UsageBreakdownViewModel;
}

interface BreakdownRowProps {
  label: string;
  value: string;
}

export function CostBreakdownContent(props: CostBreakdownContentProps): React.JSX.Element {
  const { breakdown } = props;
  return (
    <View style={styles.content} testID="turn-cost-breakdown">
      <View style={styles.heading}>
        <PresentationIcon
          color={colors.textMuted}
          name="analytics"
          size={typeScale.title.fontSize}
        />
        <View style={styles.grow}>
          <ProductText accessibilityRole="header" weight="semibold">
            Usage breakdown
          </ProductText>
          {breakdown.model === null ? null : (
            <ProductText numberOfLines={1} style={styles.meta} tone="dim">
              {breakdown.model}
            </ProductText>
          )}
          <ProductText style={styles.meta} tone="dim">
            {breakdown.status === "live" ? "Live estimate" : "Final estimate"}
          </ProductText>
        </View>
      </View>
      <BreakdownSection title="Turn">
        <BreakdownRow label="Input total" value={formatUsageTokens(breakdown.turn.inputTokens)} />
        <BreakdownRow
          label="Uncached input"
          value={formatUsageTokens(breakdown.turn.uncachedInputTokens)}
        />
        <BreakdownRow
          label="Cached input"
          value={formatUsageTokens(breakdown.turn.cachedInputTokens)}
        />
        <BreakdownRow
          label="Cache write"
          value={formatUsageTokens(breakdown.turn.cacheWriteInputTokens)}
        />
        <BreakdownRow label="Output" value={formatUsageTokens(breakdown.turn.outputTokens)} />
        <BreakdownRow
          label="Reasoning output"
          value={formatUsageTokens(breakdown.turn.reasoningOutputTokens)}
        />
        <BreakdownRow label="Total" value={formatUsageTokens(breakdown.turn.totalTokens)} />
        <BreakdownRow
          label="Latest request"
          value={formatUsageTokens(breakdown.turn.latestRequestTokens)}
        />
        <BreakdownRow label="Estimated cost" value={formatUsageCost(breakdown.turn.costUsd)} />
        <BreakdownRow
          label="Cache hit"
          value={breakdown.cacheHit === null ? "Unavailable" : breakdown.cacheHit ? "Yes" : "No"}
        />
      </BreakdownSection>
      {breakdown.context === null ? null : (
        <BreakdownSection title="Context">
          <BreakdownRow label="Used" value={formatUsageTokens(breakdown.context.usedTokens)} />
          <BreakdownRow
            label="Available"
            value={formatUsageTokens(breakdown.context.availableTokens)}
          />
          <BreakdownRow label="Window" value={formatUsageTokens(breakdown.context.totalTokens)} />
        </BreakdownSection>
      )}
      <BreakdownSection title="Session">
        <BreakdownRow
          label="Input total"
          value={formatUsageTokens(breakdown.session.inputTokens)}
        />
        <BreakdownRow
          label="Uncached input"
          value={formatUsageTokens(breakdown.session.uncachedInputTokens)}
        />
        <BreakdownRow
          label="Cached input"
          value={formatUsageTokens(breakdown.session.cachedInputTokens)}
        />
        <BreakdownRow
          label="Cache write"
          value={formatUsageTokens(breakdown.session.cacheWriteInputTokens)}
        />
        <BreakdownRow label="Output" value={formatUsageTokens(breakdown.session.outputTokens)} />
        <BreakdownRow
          label="Reasoning output"
          value={formatUsageTokens(breakdown.session.reasoningOutputTokens)}
        />
        <BreakdownRow label="Total" value={formatUsageTokens(breakdown.session.totalTokens)} />
        {breakdown.compactions === null ? null : (
          <BreakdownRow label="Compactions" value={String(breakdown.compactions)} />
        )}
        <BreakdownRow label="Estimated cost" value={formatUsageCost(breakdown.session.costUsd)} />
      </BreakdownSection>
      <ProductText style={styles.note} tone="dim">
        Costs are API-equivalent totals reported by the Companion. The V2 contract does not expose a
        per-category cost split.
      </ProductText>
    </View>
  );
}

function BreakdownSection(props: React.PropsWithChildren<{ title: string }>): React.JSX.Element {
  const { children, title } = props;
  return (
    <View style={styles.section}>
      <ProductText style={styles.sectionTitle} tone="muted" weight="semibold">
        {title}
      </ProductText>
      {children}
    </View>
  );
}

function BreakdownRow(props: BreakdownRowProps): React.JSX.Element {
  const { label, value } = props;
  return (
    <View accessibilityLabel={`${label}: ${value}`} accessible style={styles.row}>
      <ProductText style={styles.rowLabel} tone="muted">
        {label}
      </ProductText>
      <ProductText numberOfLines={1} style={styles.rowValue}>
        {value}
      </ProductText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, padding: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  heading: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  meta: { ...typeScale.caption },
  note: { ...typeScale.caption },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: spacing.lg,
  },
  rowLabel: { flexShrink: 1, ...typeScale.label },
  rowValue: { flexShrink: 0, fontVariant: ["tabular-nums"], ...typeScale.label },
  section: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.optical,
    paddingTop: spacing.xs,
  },
  sectionTitle: { ...typeScale.label },
});
