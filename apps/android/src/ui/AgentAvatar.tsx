import Ionicons from "@expo/vector-icons/Ionicons";
import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, LinearGradient, Stop, Text as SvgText } from "react-native-svg";
import { colors, iconSize, spacing, typeScale, typeWeight } from "../theme";
import { AppText as Text } from "./Typography";

const AVATAR_RADIUS = 10;
const AVATAR_SIZE = AVATAR_RADIUS + AVATAR_RADIUS;
/** The ring that separates overlapping avatars from each other and the surface. */
const RING_WIDTH = spacing.optical;
const RING_SIZE = AVATAR_SIZE + RING_WIDTH + RING_WIDTH;
const BADGE_SIZE = 10;
const BADGE_OFFSET = -spacing.optical;
const STACK_OVERLAP = 7;
const DEFAULT_STACK_LIMIT = 4;
const HUE_TURN = 360;
const HUE_SPREAD_MIN = 40;
const HUE_SPREAD_RANGE = 80;
const SPREAD_SHIFT = 9;
const FNV_OFFSET = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const FIRST_LETTER = /[\p{L}\p{N}]/u;

/** What an avatar stands for: a command gets a terminal icon, anything else a gradient. */
export type AgentAvatarSubject = {
  readonly kind: "agent" | "command" | "other";
  readonly name: string;
};

/** A small status mark on the avatar's corner. */
export type AgentAvatarBadge = "done" | "failed" | "running" | "waiting";

const BADGE_COLOR: Record<AgentAvatarBadge, string> = {
  done: colors.green,
  failed: colors.red,
  running: colors.amber,
  waiting: colors.amber,
};

/** A stable gradient circle per agent name, so one agent looks the same everywhere. */
export function AgentAvatar({
  badge = null,
  subject,
}: {
  readonly badge?: AgentAvatarBadge | null;
  readonly subject: AgentAvatarSubject;
}): React.JSX.Element {
  return (
    <View style={styles.avatar}>
      {subject.kind === "command" ? (
        <View style={styles.glyphCircle}>
          <Ionicons color={colors.textMuted} name="terminal-outline" size={iconSize.indicator} />
        </View>
      ) : (
        <GradientCircle name={subject.name} />
      )}
      {badge === null ? null : (
        <View style={[styles.badge, { backgroundColor: BADGE_COLOR[badge] }]} />
      )}
    </View>
  );
}

/** Up to `limit` overlapping avatars and a `+n` for the rest. */
export function AgentAvatarStack<Subject extends AgentAvatarSubject>({
  badgeOf,
  keyOf,
  limit = DEFAULT_STACK_LIMIT,
  subjects,
}: {
  readonly badgeOf: (subject: Subject) => AgentAvatarBadge | null;
  readonly keyOf: (subject: Subject) => string;
  readonly limit?: number;
  readonly subjects: readonly Subject[];
}): React.JSX.Element {
  const shown = subjects.slice(0, limit);
  const hidden = subjects.length - shown.length;
  return (
    <View style={styles.stack}>
      {shown.map((subject, index) => (
        <View key={keyOf(subject)} style={index > 0 && styles.stacked}>
          <AgentAvatar badge={badgeOf(subject)} subject={subject} />
        </View>
      ))}
      {hidden > 0 ? (
        <View style={[styles.glyphCircle, styles.stacked]}>
          <Text style={styles.more}>+{hidden}</Text>
        </View>
      ) : null}
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
    borderColor: colors.conversationSurface,
    borderRadius: RING_SIZE,
    borderWidth: RING_WIDTH,
    height: RING_SIZE,
    width: RING_SIZE,
  },
  badge: {
    borderColor: colors.conversationSurface,
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
  more: {
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
