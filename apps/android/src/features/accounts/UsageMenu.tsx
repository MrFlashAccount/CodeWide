import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { TurnUsageProjection } from "@codewide/sync-client";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  cloneElement,
  useState,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from "react";
import { Pressable, View, useWindowDimensions, type PressableProps } from "react-native";
import { ContentMenu } from "../../ui/ContentMenu";
import { renderContextRingView } from "./ContextRingView";
import { SessionUsageSummary } from "./SessionUsageSummary";
import { styles } from "./UsageMenu.styles";
import { AccountUsageSection } from "./accountUsage";

import { appLogger } from "../../observability/logger";
import {
  contextUsageFromProjection,
  currentThreadUsageProjection,
} from "../../data/account-rate-limits";
import type { AccountUsageSource } from "../../data/account-usage-presentation";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AnimatedNumber, compactNumberFormat } from "../../ui/AnimatedNumber";
import { AppText as Text } from "../../ui/Typography";
import { TOKEN_SYMBOL } from "../../ui/token-display";

type UsageMenuAction = {
  description?: string;
  icon: keyof typeof Ionicons.glyphMap;
  id: string;
  label: string;
  onPress: () => void;
};

interface UsageActionRowProps {
  readonly action: UsageMenuAction;
  readonly divided: boolean;
  readonly onDismiss: () => void;
}

const EMPTY_USAGE_ACTIONS: UsageMenuAction[] = [];
const MENU_MIN_WIDTH = 1;
const MENU_MAX_WIDTH = 312;
const MENU_WINDOW_GUTTER = 24;
const DEFAULT_RING_SIZE = 22;
const RING_STROKE_RATIO = 0.12;
const MIN_RING_STROKE = 2;
const PERCENT_MAX = 100;
const CIRCLE_FACTOR = 2;
const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: "compact",
});

type UsageMenuView = {
  readonly context: ReturnType<typeof contextUsageFromProjection>;
  readonly sessionCost: TurnUsageProjection["thread"]["cost"] | null;
  readonly sessionUsage: TurnUsageProjection["thread"]["tokens"] | null;
};

export function UsageMenu({
  accountSources,
  actions = EMPTY_USAGE_ACTIONS,
  align = "start",
  children,
  compactionCount,
  currentUsage,
  onRefresh,
  placement = "top",
  thread,
}: {
  accountSources?: readonly AccountUsageSource[];
  actions?: UsageMenuAction[];
  align?: "start" | "center" | "end";
  children: ReactElement<PressableProps>;
  compactionCount?: number | null;
  currentUsage?: TurnUsageProjection | null;
  onRefresh?: () => Promise<unknown>;
  placement?: "top" | "bottom" | "left" | "right";
  thread?: Thread | null;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [sessionExpanded, setSessionExpanded] = useState(false);
  const { width } = useWindowDimensions();
  const view = projectUsageMenu(currentUsage, thread);
  const contentWidth = Math.max(
    MENU_MIN_WIDTH,
    Math.min(MENU_MAX_WIDTH, width - MENU_WINDOW_GUTTER),
  );
  const hasLeadingSection = thread !== undefined || accountSources !== undefined;
  const openChanged = useEvent((open: boolean) => {
    setOpen(open);
    if (!open) {
      setSessionExpanded(false);
    }
    if (open && accountSources !== undefined && onRefresh !== undefined) {
      // Keep the current limits visible while every menu activation verifies the remote pool.
      // Banked reset grants can change without a rate-limit notification or local cache expiry.
      void onRefresh().catch((error: unknown) => {
        appLogger.warnCaught({ error, event: "account_usage.refresh.failed" });
      });
    }
  });
  const close = useEvent(() => {
    openChanged(false);
  });
  const toggleOpen = useEvent(() => {
    openChanged(!open);
  });
  // WHY: UsageMenu owns the open state while existing callers own the exact trigger element.
  // oxlint-disable-next-line react/no-clone-element
  const trigger = cloneElement(children, { onPress: toggleOpen });

  return (
    <ContentMenu
      align={align}
      onOpenChange={openChanged}
      open={open}
      placement={placement}
      trigger={trigger}
      width={contentWidth}
    >
      <UsageMenuContent
        accountSources={accountSources}
        actions={actions}
        compactionCount={compactionCount}
        hasLeadingSection={hasLeadingSection}
        onDismiss={close}
        sessionExpanded={sessionExpanded}
        setSessionExpanded={setSessionExpanded}
        showThreadUsage={thread !== undefined}
        view={view}
      />
    </ContentMenu>
  );
}

function projectUsageMenu(
  currentUsage: TurnUsageProjection | null | undefined,
  thread: Thread | null | undefined,
): UsageMenuView {
  const projection =
    currentUsage === undefined ? currentThreadUsageProjection(thread) : currentUsage;
  return {
    context: contextUsageFromProjection(projection),
    sessionCost: projection?.thread.cost ?? null,
    sessionUsage: projection?.thread.tokens ?? null,
  };
}

function UsageMenuContent({
  accountSources,
  actions,
  compactionCount,
  hasLeadingSection,
  onDismiss,
  sessionExpanded,
  setSessionExpanded,
  showThreadUsage,
  view,
}: {
  readonly accountSources: readonly AccountUsageSource[] | undefined;
  readonly actions: readonly UsageMenuAction[];
  readonly compactionCount: number | null | undefined;
  readonly hasLeadingSection: boolean;
  readonly onDismiss: () => void;
  readonly sessionExpanded: boolean;
  readonly setSessionExpanded: Dispatch<SetStateAction<boolean>>;
  readonly showThreadUsage: boolean;
  readonly view: UsageMenuView;
}): React.JSX.Element {
  return (
    <View style={styles.content} testID="usage-menu">
      {showThreadUsage ? <UsageContextSection context={view.context} /> : null}
      <AccountUsageSection accountSources={accountSources} hasContext={showThreadUsage} />
      {showThreadUsage ? (
        <SessionUsageSummary
          compactionCount={compactionCount}
          sessionCost={view.sessionCost}
          sessionExpanded={sessionExpanded}
          sessionUsage={view.sessionUsage}
          setSessionExpanded={setSessionExpanded}
        />
      ) : null}
      {actions.map((action, index) => (
        <UsageActionRow
          action={action}
          divided={hasLeadingSection && index === 0}
          key={action.id}
          onDismiss={onDismiss}
        />
      ))}
    </View>
  );
}

function UsageContextSection({
  context,
}: {
  readonly context: ReturnType<typeof contextUsageFromProjection>;
}): React.JSX.Element {
  return (
    <View style={styles.section} testID="usage-context-section">
      <Text accessibilityRole="header" style={styles.title}>
        Context
      </Text>
      <View style={styles.contextSummary}>
        <ContextRing percent={context?.usedPercent ?? 0} showValue={context !== null} size={46} />
        <ContextUsageValues context={context} />
      </View>
    </View>
  );
}

function ContextUsageValues({
  context,
}: {
  readonly context: ReturnType<typeof contextUsageFromProjection>;
}): React.JSX.Element {
  return (
    <View style={styles.grow}>
      {context === null ? (
        <Text numberOfLines={1} style={[styles.primaryValue, styles.unavailable]}>
          Usage unavailable
        </Text>
      ) : (
        <AnimatedNumber
          accessibilityLabel={`${context.usedTokens.toLocaleString()} of ${context.totalTokens.toLocaleString()} context tokens used`}
          format={compactNumberFormat}
          prefix={TOKEN_SYMBOL}
          style={styles.primaryValue}
          suffix={` / ${compactNumber(context.totalTokens)}`}
          value={context.usedTokens}
        />
      )}
      {context === null ? (
        <Text numberOfLines={1} style={styles.secondaryValue}>
          No token data for this thread
        </Text>
      ) : (
        <AnimatedNumber
          format={compactNumberFormat}
          prefix={TOKEN_SYMBOL}
          style={styles.secondaryValue}
          suffix=" available"
          value={context.remainingTokens}
        />
      )}
    </View>
  );
}

function UsageActionRow(props: UsageActionRowProps): React.JSX.Element {
  const activate = useEvent(() => {
    props.onDismiss();
    props.action.onPress();
  });
  return (
    <Pressable
      accessibilityLabel={
        props.action.description === undefined
          ? props.action.label
          : `${props.action.label}, ${props.action.description}`
      }
      accessibilityRole="button"
      onPress={activate}
      style={({ pressed }) => [
        styles.action,
        props.divided && styles.dividedAction,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.actionIcon}>
        <Ionicons color={colors.textMuted} name={props.action.icon} size={iconSize.action} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.actionTitle}>{props.action.label}</Text>
        {props.action.description !== undefined && (
          <Text numberOfLines={1} style={styles.meta}>
            {props.action.description}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export function ContextRing({
  percent,
  showValue = false,
  size = DEFAULT_RING_SIZE,
}: {
  percent: number;
  showValue?: boolean;
  size?: number;
}): React.JSX.Element {
  const strokeWidth = Math.max(MIN_RING_STROKE, size * RING_STROKE_RATIO);
  const radius = (size - strokeWidth) / CIRCLE_FACTOR;
  const circumference = CIRCLE_FACTOR * Math.PI * radius;
  const progress = Math.max(0, Math.min(PERCENT_MAX, percent));
  return renderContextRingView({ circumference, progress, radius, showValue, size, strokeWidth });
}

function compactNumber(value: number): string {
  return COMPACT_NUMBER_FORMATTER.format(value);
}
