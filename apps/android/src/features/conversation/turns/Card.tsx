/** V1 Card owner, extracted without changing interaction or resource lifetime. */
import type { Ionicons } from "@expo/vector-icons";
import { useContext, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useInsideBubbleSurface } from "../../../rendering/Bubble";
import { useEvent } from "../../../react/useEvent";
import { colors } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { styles } from "./Card.styles";
import { CopyButton } from "./MessageActionRail";
import { persistentExpansionStates, writePersistentExpansionState } from "./disclosureState";
import {
  ActiveToolCallContext,
  ExpansionItemKeyContext,
  ToolCardPlacementContext,
} from "./turnContexts";

/** How far past the header a press still counts. */
const HEADER_HIT_SLOP = 10;

type CardProps = {
  children: ReactNode;
  collapsible?: boolean;
  copyText?: () => string;
  headerMeta?: ReactNode;
  icon: keyof typeof Ionicons.glyphMap;
  initiallyExpanded?: boolean;
  onOpen?: () => void;
  openEnabled?: boolean;
  openLabel?: string;
  status?: string;
  title: string;
};

/**
 * A tool step. In a bubble it is the step's row and never draws its body; in
 * the activity sheet it discloses the body.
 */
export function Card(props: CardProps) {
  const placement = useContext(ToolCardPlacementContext);
  return placement.kind === "bubble" ? (
    <CardRow {...props} openActivity={placement.openActivity} />
  ) : (
    <DisclosureCard {...props} />
  );
}

/**
 * The step as a bubble shows it: the same header as in the sheet. A press
 * opens the step's full-screen viewer, else the activity sheet.
 */
function CardRow({
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
  const open = opensViewer ? onOpen : openActivity;
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

function DisclosureCard({
  children,
  collapsible = false,
  copyText,
  headerMeta,
  icon,
  initiallyExpanded = true,
  onOpen,
  openEnabled = true,
  openLabel,
  status,
  title,
}: CardProps) {
  const insideBubbleSurface = useInsideBubbleSurface();
  const itemKey = useContext(ExpansionItemKeyContext);
  const [expanded, setExpanded] = usePersistentExpansion(`${itemKey}:card`, initiallyExpanded);
  const activeToolCall = useContext(ActiveToolCallContext);
  const hasOpenAction = onOpen !== undefined && openEnabled;
  const toggleExpanded = useEvent(() => {
    setExpanded(!expanded);
  });
  const activateHeader = useEvent(hasOpenAction ? onOpen : toggleExpanded);
  const headerIsButton = hasOpenAction || collapsible;
  const disclosureIcon = collapsible ? (
    <InlineIcon
      color={colors.textDim}
      name={expanded ? "chevron-up" : "chevron-down"}
      role="label"
    />
  ) : null;
  return (
    <View
      collapsable={false}
      style={[styles.card, insideBubbleSurface && styles.bubbleNestedSurface]}
      testID="protocol-card"
    >
      <View collapsable={false} style={styles.cardHeader} testID="protocol-card-header">
        <Pressable
          accessibilityLabel={
            hasOpenAction
              ? (openLabel ?? `Open ${title}`)
              : collapsible
                ? `${expanded ? "Collapse" : "Expand"} ${title}`
                : undefined
          }
          accessibilityRole={headerIsButton ? "button" : undefined}
          disabled={!headerIsButton}
          hitSlop={headerIsButton ? HEADER_HIT_SLOP : undefined}
          onPress={activateHeader}
          style={styles.cardHeaderToggle}
        >
          <CardHeaderContent
            headerMeta={headerMeta}
            icon={icon}
            running={isRunningStatus(status) || activeToolCall}
            status={status}
            title={title}
          />
          {!hasOpenAction && disclosureIcon}
        </Pressable>
        {collapsible && hasOpenAction && (
          <Pressable
            accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${title}`}
            accessibilityRole="button"
            hitSlop={HEADER_HIT_SLOP}
            onPress={toggleExpanded}
            style={styles.cardDisclosure}
          >
            {disclosureIcon}
          </Pressable>
        )}
        {copyText !== undefined && !collapsible && <CopyButton getText={copyText} />}
      </View>
      {(!collapsible || expanded) && <View style={styles.cardContent}>{children}</View>}
    </View>
  );
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
  icon: keyof typeof Ionicons.glyphMap;
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
