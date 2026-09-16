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
import { ContentMenu } from "../../ui/ContentMenu";
import {
  colors,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
  iconSize,
  controlSize,
  layoutSize,
} from "../../theme";
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

export interface UsageMenuActionViewModel {
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
  action: UsageMenuActionViewModel;
  divided: boolean;
  onDismiss(): void;
}

const EMPTY_ACCOUNTS: readonly UsageAccountViewModel[] = [];
const EMPTY_ACTIONS: readonly UsageMenuActionViewModel[] = [];
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

function Text(textProps: ComponentProps<typeof NativeText>): React.JSX.Element {
  const { style, ...props } = textProps;
  const flattened = StyleSheet.flatten(style);
  const rawWeight = flattened?.fontWeight;
  const numericWeight = rawWeight === "bold" ? 700 : Number.parseInt(String(rawWeight ?? 400), 10);
  const fontFamily =
    numericWeight <= 400
      ? productFonts.regular
      : numericWeight <= 500
        ? productFonts.medium
        : productFonts.semibold;
  return <NativeText {...props} style={[style, { fontFamily, fontWeight: typeWeight.regular }]} />;
}

interface UsageMenuViewProps {
  accounts?: readonly UsageAccountViewModel[];
  actions?: readonly UsageMenuActionViewModel[];
  align?: "center" | "end" | "start";
  children: ReactNode;
  context?: UsageContextViewModel | null;
  placement?: "bottom" | "left" | "right" | "top";
  session?: UsageSessionViewModel | null;
  triggerAccessibilityLabel: string;
  triggerStyle?: ComponentProps<typeof Pressable>["style"];
}

export function UsageMenuView(props: UsageMenuViewProps): React.JSX.Element {
  const {
    accounts = EMPTY_ACCOUNTS,
    actions = EMPTY_ACTIONS,
    align = "start",
    children,
    context,
    placement = "top",
    session,
    triggerAccessibilityLabel,
    triggerStyle,
  } = props;
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
  const toggleOpen = useEvent(() => {
    changeOpen(!open);
  });
  return (
    <ContentMenu
      align={align}
      onOpenChange={changeOpen}
      open={open}
      placement={placement}
      trigger={
        <Pressable
          accessibilityLabel={triggerAccessibilityLabel}
          accessibilityRole="button"
          onPress={toggleOpen}
          style={triggerStyle}
        >
          {children}
        </Pressable>
      }
      width={contentWidth}
    >
      <PresentationIconProvider renderIcon={portalIconRenderer}>
        <View style={StyleSheet.flatten([styles.popover, { maxHeight: contentMaxHeight }])}>
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
                        ◇{compactNumber(context.usedTokens)} / {compactNumber(context.totalTokens)}
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
                style={[styles.section, context === undefined ? undefined : styles.dividedSection]}
                testID="usage-accounts-section"
              >
                <View style={styles.sectionTitleRow}>
                  <PresentationIcon color={colors.textMuted} name="people" size={iconSize.inline} />
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
              <View style={[styles.section, styles.dividedSection]} testID="usage-session-section">
                <Pressable
                  accessibilityLabel="Session usage"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: sessionExpanded }}
                  onPress={toggleSession}
                  style={styles.sessionSummaryRow}
                  testID="usage-session-summary"
                >
                  <PresentationIcon
                    color={colors.textMuted}
                    name="analytics"
                    size={iconSize.inline}
                  />
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
                    size={iconSize.inline}
                  />
                </Pressable>
                {sessionExpanded && session !== null ? (
                  <View style={styles.sessionDetails}>
                    <SessionRow label="Input" value={`◇${session.inputTokens.toLocaleString()}`} />
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
                  context !== undefined || accounts.length > 0 || session !== undefined || index > 0
                }
                key={action.id}
                onDismiss={close}
              />
            ))}
          </ScrollView>
        </View>
      </PresentationIconProvider>
    </ContentMenu>
  );
}

function UsageActionRow(props: UsageActionRowProps): React.JSX.Element {
  const { action, divided, onDismiss } = props;
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
        <PresentationIcon color={colors.textMuted} name={action.icon} size={iconSize.action} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.actionTitle}>{action.label}</Text>
        {action.description === undefined ? null : (
          <Text numberOfLines={1} style={styles.meta}>
            {action.description}
          </Text>
        )}
      </View>
      <PresentationIcon color={colors.textDim} name="chevronForward" size={iconSize.inline} />
    </Pressable>
  );
}

function SessionRow(props: SessionRowProps): React.JSX.Element {
  const { emphasized = false, label, value } = props;
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
  accountName: { color: colors.text, ...typeScale.body },
  accountRow: { gap: spacing.xxs, paddingVertical: spacing.xxs },
  accountStateDot: { borderRadius: radii.pill, height: 8, width: 8 },
  accountTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.regular,
  },
  accountValue: {
    color: colors.text,
    flexShrink: 0,
    fontVariant: ["tabular-nums"],
    ...typeScale.body,
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
  actionTitle: { color: colors.text, ...typeScale.body },
  content: { paddingVertical: spacing.xxs },
  contextSummary: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: layoutSize.header,
  },
  dividedAction: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dividedSection: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, minWidth: 0 },
  meta: { color: colors.textDim, ...typeScale.label },
  popover: { borderRadius: radii.large, overflow: "hidden", padding: 0 },
  primaryValue: {
    color: colors.text,
    ...typeScale.heading,
    fontVariant: ["tabular-nums"],
    fontWeight: typeWeight.semibold,
  },
  relativeReset: {
    color: colors.text,
    flexShrink: 0,
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
    fontWeight: typeWeight.semibold,
  },
  resetRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: layoutSize.metadataRow,
  },
  secondaryValue: {
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
    ...typeScale.body,
  },
  section: { gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  sectionTitleRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  sessionCostText: { color: colors.textMuted, flexShrink: 0, ...typeScale.label },
  sessionDetails: { gap: spacing.optical, paddingBottom: spacing.optical },
  sessionSummaryRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.regular,
  },
  sessionSummarySeparator: { color: colors.textMuted, flexShrink: 0, ...typeScale.label },
  sessionSummaryText: { color: colors.textMuted, flexShrink: 1, ...typeScale.label },
  sessionSummaryValues: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xxs,
    justifyContent: "flex-end",
    minWidth: 0,
  },
  sessionUsageLabel: { color: colors.textMuted, flexShrink: 1, ...typeScale.body },
  sessionUsageRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: controlSize.compact,
  },
  sessionUsageTotalRow: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.xxs,
    minHeight: controlSize.compact,
    paddingTop: spacing.xxs,
  },
  sessionUsageTotalText: { color: colors.text, fontWeight: typeWeight.semibold },
  sessionUsageValue: { color: colors.text, flexShrink: 0, ...typeScale.label },
  title: { color: colors.textMuted, ...typeScale.label },
  unavailable: { color: colors.textMuted },
});
