import { Popover } from "heroui-native/popover";
import { useState, type ComponentProps, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  View,
  useWindowDimensions,
} from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { productFonts } from "../../ui/product-fonts";
import { ContextRingView } from "../conversation/ContextRingActionView";
import {
  PresentationIcon,
  PresentationIconProvider,
  type PresentationIconName,
  usePresentationIconRenderer,
} from "../icons/PresentationIcon";

export interface UsageAccountViewModel {
  active: boolean;
  detail: string;
  enabled: boolean;
  exhausted: boolean;
  id: string;
  label: string;
  limitState: "disabled" | "limitReached" | "ready" | "refreshRequired" | "unavailable";
  remainingPercent: number | null;
  resetAt: string | null;
  resetIn: string | null;
}

export interface UsageContextViewModel {
  availableTokens: number;
  model: string | null;
  percent: number;
  totalTokens: number;
  usedTokens: number;
}

export interface UsageSessionViewModel {
  compactions: number | null;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsagePopoverActionViewModel {
  description?: string;
  icon: PresentationIconName;
  id: string;
  label: string;
  onPress(): void;
}

interface SessionRowProps {
  emphasized?: boolean;
  label: string;
  value: string;
}

interface UsageActionRowProps {
  action: UsagePopoverActionViewModel;
  divided: boolean;
  onDismiss(): void;
}

const EMPTY_ACCOUNTS: readonly UsageAccountViewModel[] = [];
const EMPTY_ACTIONS: readonly UsagePopoverActionViewModel[] = [];
const COMPACT_NUMBER_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: "compact",
});
const ACCOUNT_LIMIT_LABELS: Record<UsageAccountViewModel["limitState"], string> = {
  disabled: "Disabled",
  limitReached: "Limit reached",
  ready: "Unavailable",
  refreshRequired: "Refresh required",
  unavailable: "Unavailable",
};

function Text({ style, ...props }: ComponentProps<typeof NativeText>): React.JSX.Element {
  const flattened = StyleSheet.flatten(style);
  const rawWeight = flattened?.fontWeight;
  const numericWeight = rawWeight === "bold" ? 700 : Number.parseInt(String(rawWeight ?? 400), 10);
  const fontFamily =
    numericWeight <= 400
      ? productFonts.regular
      : numericWeight <= 500
        ? productFonts.medium
        : productFonts.semibold;
  return <NativeText {...props} style={[style, { fontFamily, fontWeight: "400" }]} />;
}

interface UsagePopoverViewProps {
  accounts?: readonly UsageAccountViewModel[];
  actions?: readonly UsagePopoverActionViewModel[];
  align?: "center" | "end" | "start";
  children: ReactNode;
  context?: UsageContextViewModel | null;
  placement?: "bottom" | "left" | "right" | "top";
  session?: UsageSessionViewModel | null;
  triggerAccessibilityLabel: string;
  triggerStyle?: ComponentProps<typeof Pressable>["style"];
}

export function UsagePopoverView({
  accounts = EMPTY_ACCOUNTS,
  actions = EMPTY_ACTIONS,
  align = "start",
  children,
  context,
  placement = "top",
  session,
  triggerAccessibilityLabel,
  triggerStyle,
}: UsagePopoverViewProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [sessionExpanded, setSessionExpanded] = useState(false);
  const portalIconRenderer = usePresentationIconRenderer();
  const { height, width } = useWindowDimensions();
  const contentWidth = Math.max(1, Math.min(312, width - 24));
  const contentMaxHeight = Math.max(1, height - 24);
  const close = useEvent(() => {
    setOpen(false);
    setSessionExpanded(false);
  });
  const changeOpen = useEvent((next: boolean) => {
    setOpen(next);
    if (!next) setSessionExpanded(false);
  });
  const toggleSession = useEvent(() => setSessionExpanded((current) => !current));
  return (
    <Popover isOpen={open} onOpenChange={changeOpen} presentation="popover">
      <Popover.Trigger asChild>
        <Pressable
          accessibilityLabel={triggerAccessibilityLabel}
          accessibilityRole="button"
          style={triggerStyle}
        >
          {children}
        </Pressable>
      </Popover.Trigger>
      <Popover.Portal>
        <PresentationIconProvider renderIcon={portalIconRenderer}>
          <Popover.Overlay className="bg-backdrop" />
          <Popover.Content
            align={align}
            className="border border-border"
            offset={8}
            placement={placement}
            presentation="popover"
            style={StyleSheet.flatten([styles.popover, { maxHeight: contentMaxHeight }])}
            width={contentWidth}
          >
            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: contentMaxHeight }}
              testID="usage-popover"
            >
              {context === undefined ? null : (
                <View style={styles.section} testID="usage-context-section">
                  <Text accessibilityRole="header" style={styles.title}>
                    Context
                  </Text>
                  <View style={styles.contextSummary}>
                    <ContextRingView
                      percent={context?.percent ?? 0}
                      showValue={context !== null}
                      size={46}
                    />
                    <View style={styles.grow}>
                      {context === null ? (
                        <Text numberOfLines={1} style={[styles.primaryValue, styles.unavailable]}>
                          Usage unavailable
                        </Text>
                      ) : (
                        <Text numberOfLines={1} style={styles.primaryValue}>
                          ◇{compactNumber(context.usedTokens)} /{" "}
                          {compactNumber(context.totalTokens)}
                        </Text>
                      )}
                      {context === null ? (
                        <Text numberOfLines={1} style={styles.secondaryValue}>
                          No token data for this thread
                        </Text>
                      ) : (
                        <Text numberOfLines={1} style={styles.secondaryValue}>
                          ◇{compactNumber(context.availableTokens)} available
                        </Text>
                      )}
                      {context?.model === null || context?.model === undefined ? null : (
                        <Text numberOfLines={1} style={styles.meta}>
                          {context.model}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              )}

              {accounts.length === 0 ? null : (
                <View
                  style={[
                    styles.section,
                    context === undefined ? undefined : styles.dividedSection,
                  ]}
                  testID="usage-accounts-section"
                >
                  <View style={styles.sectionTitleRow}>
                    <PresentationIcon color={colors.textMuted} name="people" size={17} />
                    <Text accessibilityRole="header" style={styles.title}>
                      Accounts
                    </Text>
                  </View>
                  {accounts.map((account, index) => (
                    <View
                      key={account.id}
                      style={[styles.accountRow, index === 0 ? undefined : styles.accountDivider]}
                    >
                      <View style={styles.accountTitleRow}>
                        <View
                          style={[
                            styles.accountStateDot,
                            {
                              backgroundColor: account.active
                                ? colors.green
                                : account.exhausted
                                  ? colors.red
                                  : colors.textDim,
                            },
                          ]}
                        />
                        <View style={styles.grow}>
                          <Text numberOfLines={1} style={styles.accountName}>
                            {account.label}
                          </Text>
                          <Text numberOfLines={1} style={styles.meta}>
                            {account.detail}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.accountValue,
                            account.remainingPercent === null ? styles.unavailable : undefined,
                          ]}
                        >
                          {account.limitState === "ready" && account.remainingPercent !== null
                            ? `${Math.round(account.remainingPercent)}% left`
                            : accountLimitLabel(account.limitState)}
                        </Text>
                      </View>
                      {account.resetAt === null ? null : (
                        <View style={styles.resetRow}>
                          <Text numberOfLines={1} style={[styles.meta, styles.grow]}>
                            Resets {account.resetAt}
                          </Text>
                          {account.resetIn === null ? null : (
                            <Text numberOfLines={1} style={styles.relativeReset}>
                              {account.resetIn}
                            </Text>
                          )}
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {session === undefined ? null : (
                <View
                  style={[styles.section, styles.dividedSection]}
                  testID="usage-session-section"
                >
                  <Pressable
                    accessibilityLabel="Session usage"
                    accessibilityRole="button"
                    accessibilityState={{ expanded: sessionExpanded }}
                    onPress={toggleSession}
                    style={styles.sessionSummaryRow}
                    testID="usage-session-summary"
                  >
                    <PresentationIcon color={colors.textMuted} name="analytics" size={17} />
                    <Text style={styles.title}>Session</Text>
                    <View style={styles.sessionSummaryValues}>
                      {session === null ? (
                        <Text style={styles.sessionSummaryText}>Unavailable</Text>
                      ) : (
                        <>
                          <Text style={styles.sessionSummaryText}>
                            ◇{compactNumber(session.totalTokens)}
                          </Text>
                          {session.costUsd === null ? null : (
                            <>
                              <Text style={styles.sessionSummarySeparator}>·</Text>
                              <Text style={styles.sessionCostText}>
                                ≈${session.costUsd.toFixed(3)}
                              </Text>
                            </>
                          )}
                        </>
                      )}
                    </View>
                    <PresentationIcon
                      color={colors.textDim}
                      name={sessionExpanded ? "chevronUp" : "chevronDown"}
                      size={15}
                    />
                  </Pressable>
                  {sessionExpanded && session !== null ? (
                    <View style={styles.sessionDetails}>
                      <SessionRow
                        label="Input"
                        value={`◇${session.inputTokens.toLocaleString()}`}
                      />
                      <SessionRow
                        label="Output"
                        value={`◇${session.outputTokens.toLocaleString()}`}
                      />
                      <SessionRow
                        emphasized
                        label="Total"
                        value={`◇${session.totalTokens.toLocaleString()}`}
                      />
                      <SessionRow
                        label="Compactions"
                        value={
                          session.compactions === null
                            ? "History not loaded"
                            : String(session.compactions)
                        }
                      />
                    </View>
                  ) : null}
                </View>
              )}

              {actions.map((action, index) => (
                <UsageActionRow
                  action={action}
                  divided={
                    context !== undefined ||
                    accounts.length > 0 ||
                    session !== undefined ||
                    index > 0
                  }
                  key={action.id}
                  onDismiss={close}
                />
              ))}
            </ScrollView>
            <Popover.Arrow />
          </Popover.Content>
        </PresentationIconProvider>
      </Popover.Portal>
    </Popover>
  );
}

function UsageActionRow({ action, divided, onDismiss }: UsageActionRowProps): React.JSX.Element {
  const activate = useEvent(() => {
    onDismiss();
    action.onPress();
  });
  return (
    <Pressable
      accessibilityLabel={
        action.description === undefined ? action.label : `${action.label}, ${action.description}`
      }
      accessibilityRole="button"
      onPress={activate}
      style={[styles.action, divided ? styles.dividedAction : undefined]}
    >
      <View style={styles.actionIcon}>
        <PresentationIcon color={colors.textMuted} name={action.icon} size={18} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.actionTitle}>{action.label}</Text>
        {action.description === undefined ? null : (
          <Text numberOfLines={1} style={styles.meta}>
            {action.description}
          </Text>
        )}
      </View>
      <PresentationIcon color={colors.textDim} name="chevronForward" size={16} />
    </Pressable>
  );
}

function SessionRow({ emphasized = false, label, value }: SessionRowProps): React.JSX.Element {
  return (
    <View style={[styles.sessionUsageRow, emphasized ? styles.sessionUsageTotalRow : undefined]}>
      <Text
        style={[styles.sessionUsageLabel, emphasized ? styles.sessionUsageTotalText : undefined]}
      >
        {label}
      </Text>
      <Text
        style={[styles.sessionUsageValue, emphasized ? styles.sessionUsageTotalText : undefined]}
      >
        {value}
      </Text>
    </View>
  );
}

function compactNumber(value: number): string {
  return COMPACT_NUMBER_FORMAT.format(value);
}

function accountLimitLabel(state: UsageAccountViewModel["limitState"]): string {
  return ACCOUNT_LIMIT_LABELS[state];
}

const styles = StyleSheet.create({
  accountDivider: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.xs,
  },
  accountName: { color: colors.text, ...typeScale.labelLarge },
  accountRow: { gap: 3, paddingVertical: spacing.xxs },
  accountStateDot: { borderRadius: 4, height: 8, width: 8 },
  accountTitleRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs, minHeight: 38 },
  accountValue: {
    color: colors.text,
    flexShrink: 0,
    fontVariant: ["tabular-nums"],
    ...typeScale.labelLarge,
  },
  action: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  actionIcon: {
    alignItems: "center",
    flexShrink: 0,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  actionTitle: { color: colors.text, ...typeScale.labelLarge },
  content: { paddingVertical: spacing.xxs },
  contextSummary: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 52 },
  dividedAction: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  dividedSection: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, minWidth: 0 },
  meta: { color: colors.textDim, fontSize: 11, lineHeight: 15 },
  popover: { borderRadius: radii.large, overflow: "hidden", padding: 0 },
  primaryValue: {
    color: colors.text,
    fontSize: 18,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
    lineHeight: 23,
  },
  relativeReset: {
    color: colors.text,
    flexShrink: 0,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
    lineHeight: 16,
  },
  resetRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs, minHeight: 24 },
  secondaryValue: {
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
    ...typeScale.bodyMedium,
  },
  section: { gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  sectionTitleRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  sessionCostText: { color: colors.textMuted, flexShrink: 0, fontSize: 11, lineHeight: 15 },
  sessionDetails: { gap: 2, paddingBottom: 2 },
  sessionSummaryRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs, minHeight: 38 },
  sessionSummarySeparator: { color: colors.textMuted, flexShrink: 0, fontSize: 11, lineHeight: 15 },
  sessionSummaryText: { color: colors.textMuted, flexShrink: 1, fontSize: 11, lineHeight: 15 },
  sessionSummaryValues: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 4,
    justifyContent: "flex-end",
    minWidth: 0,
  },
  sessionUsageLabel: { color: colors.textMuted, flexShrink: 1, ...typeScale.bodyMedium },
  sessionUsageRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: 25,
  },
  sessionUsageTotalRow: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 3,
    minHeight: 30,
    paddingTop: 5,
  },
  sessionUsageTotalText: { color: colors.text, fontWeight: "700" },
  sessionUsageValue: { color: colors.text, flexShrink: 0, fontSize: 12, lineHeight: 17 },
  title: { color: colors.textMuted, ...typeScale.labelMedium },
  unavailable: { color: colors.textMuted },
});
