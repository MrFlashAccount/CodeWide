import Ionicons from "@expo/vector-icons/Ionicons";
import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, LinearGradient, Stop, Text as SvgText } from "react-native-svg";
import { colors, iconSize, spacing, typeScale, typeWeight } from "../theme";
import { AppText as Text } from "./Typography";

const AVATAR_RADIUS = 10;
const AVATAR_SIZE = AVATAR_RADIUS + AVATAR_RADIUS;
/**
 * The ring that separates overlapping avatars from each other. It is painted
 * in the color of the surface under the avatar, so it reads as a gap, not an outline.
 */
const RING_WIDTH = spacing.optical;
const RING_SIZE = AVATAR_SIZE + RING_WIDTH + RING_WIDTH;
const BADGE_SIZE = 10;
const BADGE_OFFSET = -spacing.optical;
const STACK_OVERLAP = 10;
const DEFAULT_STACK_LIMIT = 4;
const HUE_TURN = 360;
const HUE_SPREAD_MIN = 40;
const HUE_SPREAD_RANGE = 80;
const SPREAD_SHIFT = 9;
const FNV_OFFSET = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const FIRST_LETTER = /[\p{L}\p{N}]/u;

/**
 * What an avatar stands for: an agent gets a gradient with its initial; a
 * command or any other background task gets a terminal icon, never an agent's look.
 */
export type AgentAvatarSubject = {
  readonly kind: "agent" | "command" | "other";
  readonly name: string;
};

/** A small status mark on the avatar's corner. */
export type AgentAvatarBadge = "done" | "failed" | "running" | "waiting";

/** Green for done, red for a failure, grey while work goes on. */
const BADGE_COLOR: Record<AgentAvatarBadge, string> = {
  done: colors.green,
  failed: colors.red,
  running: colors.textMuted,
  waiting: colors.textMuted,
};

/** A stable gradient circle per agent name, so one agent looks the same everywhere. */
export function AgentAvatar({
  badge = null,
  subject,
  surface,
}: {
  readonly badge?: AgentAvatarBadge | null;
  readonly subject: AgentAvatarSubject;
  /** The color of the surface the avatar sits on, for its ring. */
  readonly surface: string;
}): React.JSX.Element {
  return (
    <View style={[styles.avatar, { borderColor: surface }]} testID="agent-avatar">
      {subject.kind === "agent" ? (
        <GradientCircle name={subject.name} />
      ) : (
        <View style={styles.glyphCircle}>
          <Ionicons color={colors.textMuted} name="terminal-outline" size={iconSize.indicator} />
        </View>
      )}
      {badge === null ? null : (
        <View
          style={[styles.badge, { backgroundColor: BADGE_COLOR[badge], borderColor: surface }]}
        />
      )}
    </View>
  );
}

/**
 * Up to `limit` overlapping avatars and a `+n` for the rest. The earliest
 * subject is on top, each later one tucked under its predecessor.
 */
export function AgentAvatarStack<Subject extends AgentAvatarSubject>({
  badgeOf,
  keyOf,
  limit = DEFAULT_STACK_LIMIT,
  subjects,
  surface,
}: {
  readonly badgeOf: (subject: Subject) => AgentAvatarBadge | null;
  readonly keyOf: (subject: Subject) => string;
  readonly limit?: number;
  readonly subjects: readonly Subject[];
  /** The color of the surface the stack sits on, for the avatars' rings. */
  readonly surface: string;
}): React.JSX.Element {
  const shown = subjects.slice(0, limit);
  const hidden = subjects.length - shown.length;
  return (
    <View style={styles.stack}>
      {shown.map((subject, index) => (
        <View
          key={keyOf(subject)}
          style={[index > 0 && styles.stacked, { zIndex: shown.length - index }]}
        >
          <AgentAvatar badge={badgeOf(subject)} subject={subject} surface={surface} />
        </View>
      ))}
      {hidden > 0 ? <HiddenCount count={hidden} surface={surface} /> : null}
    </View>
  );
}

/** The `+n` after a stack, ringed like the avatars it stands for. */
function HiddenCount({
  count,
  surface,
}: {
  readonly count: number;
  readonly surface: string;
}): React.JSX.Element {
  return (
    <View style={[styles.avatar, styles.stacked, { borderColor: surface }]}>
      <View style={styles.glyphCircle}>
        <Text style={styles.moreLabel}>+{count}</Text>
      </View>
    </View>
  );
}

function GradientCircle({ name }: { readonly name: string }): React.JSX.Element {
  const id = useId();
  const hash = nameHash(name);
  const from = hash % HUE_TURN;
  const to = (from + HUE_SPREAD_MIN + ((hash >>> SPREAD_SHIFT) % HUE_SPREAD_RANGE)) % HUE_TURN;
  const letter = FIRST_LETTER.exec(name)?.[0]?.toUpperCase() ?? "•";
  return (
    <Svg height={AVATAR_SIZE} width={AVATAR_SIZE}>
      {/* A gradient needs no Defs wrapper; its web typing accepts no children. */}
      <LinearGradient id={id} x1="0" x2="1" y1="0" y2="1">
        <Stop offset="0" stopColor={`hsl(${String(from)}, 70%, 58%)`} />
        <Stop offset="1" stopColor={`hsl(${String(to)}, 65%, 42%)`} />
      </LinearGradient>
      <Circle cx={AVATAR_RADIUS} cy={AVATAR_RADIUS} fill={`url(#${id})`} r={AVATAR_RADIUS} />
      <SvgText
        alignmentBaseline="central"
        fill={colors.text}
        fontSize={typeScale.caption.fontSize}
        fontWeight={typeWeight.semibold}
        textAnchor="middle"
        x={AVATAR_RADIUS}
        y={AVATAR_RADIUS}
      >
        {letter}
      </SvgText>
    </Svg>
  );
}

/** FNV-1a: a cheap stable hash; colors must not change between launches. */
function nameHash(name: string): number {
  let hash = FNV_OFFSET;
  for (const char of name) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), FNV_PRIME);
  }
  return hash >>> 0;
}

const styles = StyleSheet.create({
  avatar: {
    borderRadius: RING_SIZE,
    borderWidth: RING_WIDTH,
    height: RING_SIZE,
    width: RING_SIZE,
  },
  badge: {
    borderRadius: BADGE_SIZE,
    borderWidth: RING_WIDTH,
    bottom: BADGE_OFFSET,
    height: BADGE_SIZE,
    position: "absolute",
    right: BADGE_OFFSET,
    width: BADGE_SIZE,
  },
  glyphCircle: {
    alignItems: "center",
    backgroundColor: colors.surfaceHover,
    borderRadius: AVATAR_SIZE,
    height: AVATAR_SIZE,
    justifyContent: "center",
    width: AVATAR_SIZE,
  },
  moreLabel: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  stack: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
  },
  stacked: {
    marginLeft: -STACK_OVERLAP,
  },
});
