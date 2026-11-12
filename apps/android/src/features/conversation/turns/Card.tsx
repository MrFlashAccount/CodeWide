/** V1 Card owner, extracted without changing interaction or resource lifetime. */
import { useContext, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { ComposeIconName } from "../../../presentation/icons/composeIconNames";
import { useInsideBubbleSurface } from "../../../rendering/Bubble";
import { useEvent } from "../../../react/useEvent";
import { colors } from "../../../theme";
import { AppListItem } from "../../../ui/AppListItem";
import { listRowHeight } from "../../../ui/AppListRow.types";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { styles } from "./Card.styles";
import { CopyButton } from "./MessageActionRail";
import { persistentExpansionStates, writePersistentExpansionState } from "./disclosureState";
import {
  ActiveToolCallContext,
  ToolCardPlacementContext,
  type ToolCardPlacement,
} from "./turnContexts";

/** How far past the header a press still counts. */
const HEADER_HIT_SLOP = 10;

type CardProps = {
  children: ReactNode;
  copyText?: () => string;
  detailSheetEnabled?: boolean;
  headerMeta?: ReactNode;
  icon: ComposeIconName;
  onOpen?: () => void;
  openEnabled?: boolean;
  openLabel?: string;
  status?: string;
  title: string;
};

/**
 * A tool step. A bubble only draws its row. Activity rows open their semantic
 * viewer, or an explicitly enabled detail sheet such as Web Search results.
 */
export function Card(props: CardProps) {
  const placement = useContext(ToolCardPlacementContext);
  if (placement.kind === "bubble") {
    return <CardRow {...props} openActivity={placement.openActivity} />;
  }
  if (placement.kind === "sheet") {
    return <ActivityListCard {...props} placement={placement} />;
  }
  return <ActivitySheetDetail {...props} />;
}

/** One fixed-height native list row; detail belongs to its viewer or the fallback sheet. */
function ActivityListCard({
  detailSheetEnabled = false,
  icon,
  onOpen,
  openEnabled = true,
  openLabel,
  placement,
  status,
  title,
}: CardProps & { placement: Extract<ToolCardPlacement, { kind: "sheet" }> }) {
  const hasOpenAction = onOpen !== undefined && openEnabled;
  const open = hasOpenAction ? onOpen : detailSheetEnabled ? placement.openDetail : undefined;
  const failed = status === "failed" || status === "error";
  const activate = useEvent(open);
  return (
    <AppListItem
      accessibilityLabel={
        open === undefined
          ? `${title}${failed ? ", failed" : ""}`
          : `${hasOpenAction ? (openLabel ?? `Open ${title}`) : `Open ${title}`}${failed ? ", failed" : ""}`
      }
      danger={failed}
      description={placement.description}
      fixedHeight={listRowHeight.double}
      leadingIcon={{ name: icon }}
      {...(open === undefined ? {} : { onPress: activate })}
      testID="activity-step-row"
      title={title}
      {...(failed ? { trailingIcon: { color: colors.red, name: "alert-circle" as const } } : {})}
    />
  );
}

/** The fallback sheet owns the detailed body; it has no nested disclosure control. */
function ActivitySheetDetail({ children, copyText }: CardProps) {
  return (
    <View style={styles.cardContent} testID="activity-step-detail">
      {children}
      {copyText !== undefined && <CopyButton getText={copyText} />}
    </View>
  );
}

/**
 * The step as a bubble shows it: the same header as in the sheet. A press
 * opens the step's full-screen viewer, else the activity sheet.
 */
function CardRow({
  detailSheetEnabled = false,
  headerMeta,
  icon,
  onOpen,
  openActivity,
  openEnabled = true,
  openLabel,
  status,
  title,
}: CardProps & { openActivity: (() => void) | null }) {
  const insideBubbleSurface = useInsideBubbleSurface();
  const activeToolCall = useContext(ActiveToolCallContext);
  const opensViewer = onOpen !== undefined && openEnabled;
  const open = cardRowOpen({ detailSheetEnabled, onOpen, openActivity, opensViewer });
  const activate = useEvent(() => {
    open?.();
  });
  return (
    <View
      collapsable={false}
      style={[styles.card, insideBubbleSurface && styles.bubbleNestedSurface]}
      testID="protocol-card"
    >
      <Pressable
        {...rowPressProps(open !== null, opensViewer ? openLabel : undefined, title)}
        onPress={activate}
        style={[styles.cardHeader, styles.cardHeaderToggle]}
        testID="protocol-card-header"
      >
        <CardHeaderContent
          headerMeta={headerMeta}
          icon={icon}
          running={isRunningStatus(status) || activeToolCall}
          status={status}
          title={title}
        />
      </Pressable>
    </View>
  );
}

function cardRowOpen({
  detailSheetEnabled,
  onOpen,
  openActivity,
  opensViewer,
}: {
  readonly detailSheetEnabled: boolean;
  readonly onOpen: (() => void) | undefined;
  readonly openActivity: (() => void) | null;
  readonly opensViewer: boolean;
}): (() => void) | null {
  if (opensViewer) {
    return onOpen ?? null;
  }
  return detailSheetEnabled ? openActivity : null;
}

/** A row opens something only when it has a target; a viewer may name its own action. */
function rowPressProps(
  interactive: boolean,
  viewerLabel: string | undefined,
  title: string,
): {
  readonly accessibilityLabel: string | undefined;
  readonly accessibilityRole: "button" | undefined;
  readonly disabled: boolean;
  readonly hitSlop: number | undefined;
} {
  return {
    accessibilityLabel: interactive ? (viewerLabel ?? `Open ${title}`) : undefined,
    accessibilityRole: interactive ? "button" : undefined,
    disabled: !interactive,
    hitSlop: interactive ? HEADER_HIT_SLOP : undefined,
  };
}

/** The icon, the title (shimmering while the step runs), its meta and status. */
function CardHeaderContent({
  headerMeta,
  icon,
  running,
  status,
  title,
}: {
  headerMeta: ReactNode;
  icon: ComposeIconName;
  running: boolean;
  status: string | undefined;
  title: string;
}) {
  return (
    <>
      <View style={styles.cardIconSlot} testID="protocol-card-icon">
        <InlineIcon color={colors.textMuted} name={icon} role="label" />
      </View>
      {running ? (
        <WaveText
          containerStyle={styles.cardTitleWave}
          key="running-title"
          style={styles.cardTitle}
          text={title}
        />
      ) : (
        <Text key="settled-title" numberOfLines={1} style={styles.cardTitle}>
          {title}
        </Text>
      )}
      <View style={styles.flex} />
      {headerMeta}
      {typeof status === "string" && status !== "" && !running && (
        <View accessibilityLabel={`Status ${status}`} accessible style={styles.cardStatusIcon}>
          {status === "failed" || status === "error" ? (
            <InlineIcon color={colors.red} name="alert-circle" role="label" />
          ) : (
            <View style={styles.cardStatusDot} />
          )}
        </View>
      )}
    </>
  );
}

function isRunningStatus(status: string | undefined): boolean {
  return status === "inProgress" || status === "running";
}

export function usePersistentExpansion(
  localKey: string,
  initialValue: boolean,
): [boolean, (value: boolean | ((current: boolean) => boolean)) => void] {
  // ExpansionItemKey already includes the connection/thread/turn identity.
  // The bounded external cache survives LegendList recycling without a broad
  // React context update whenever an unrelated live turn changes.
  const [value, setValue] = useState(() => persistentExpansionStates.get(localKey) ?? initialValue);
  const persistValue = (next: boolean | ((current: boolean) => boolean)) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      writePersistentExpansionState(localKey, resolved);
      return resolved;
    });
  };
  return [value, persistValue];
}
