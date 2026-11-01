import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";

import {
  colors,
  controlSize,
  iconSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { compactAge } from "../../../ui/relativeAge";
import { AppText as Text } from "../../../ui/Typography";
import { MessageAvatar } from "../../messageContent/MessageAvatar";
import { eventGlyph, eventRunLabel, messageAuthor, type EventTone } from "./conversationContent";
import type { EventEntry, TimelineItem } from "./discussionModel";
import { EventCommitList } from "./EventCommitList";
import { forgeEvent, timelineEventLabel, type TimelineEvent } from "./timelineEvent";

/**
 * One full-width timeline row, github.com style: the glyph in a tinted 28dp
 * circle, the actor's 20dp avatar, the bold login and what happened on one
 * line, and the age at the right edge. Spoken as one sentence.
 */
export function EventLine({
  event,
  nowMs,
  testID,
}: {
  readonly event: TimelineEvent;
  readonly nowMs: number;
  readonly testID: string;
}): React.JSX.Element {
  return (
    <View
      accessibilityLabel={timelineEventLabel(event, nowMs)}
      accessible
      style={styles.row}
      testID={testID}
    >
      <EventGlyphCircle event={event} />
      <EventSentence event={event} />
      <Text style={styles.age}>{compactAge(event.createdAt, nowMs)}</Text>
    </View>
  );
}

/** A single event, or a collapsed run of same-category events that expands in place; the run shows its newest age. */
export function EventRun({
  events,
  nowMs,
}: {
  readonly events: Extract<TimelineItem, { readonly kind: "events" }>["events"];
  readonly nowMs: number;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [first] = events;
  if (events.length === 1) {
    return <ForgeEventLine event={first} nowMs={nowMs} />;
  }
  return (
    <View testID={`conversation-events-${first.id}`}>
      <RunToggle
        event={{
          actor: null,
          createdAt: first.createdAt,
          glyph: eventGlyph(first.category),
          text: eventRunLabel(first.category, events.length),
        }}
        expanded={expanded}
        nowMs={nowMs}
        onToggle={() => {
          setExpanded(!expanded);
        }}
        testID={`conversation-events-${first.id}-toggle`}
      />
      {expanded
        ? events.map((event) => <ForgeEventLine event={event} key={event.id} nowMs={nowMs} />)
        : null}
    </View>
  );
}

/** A forge event's row, with a push's commits listed below it. */
function ForgeEventLine({
  event,
  nowMs,
}: {
  readonly event: EventEntry;
  readonly nowMs: number;
}): React.JSX.Element {
  const testID = `conversation-event-${event.id}`;
  const line = <EventLine event={forgeEvent(event)} nowMs={nowMs} testID={testID} />;
  if (event.commits === null) {
    return line;
  }
  return (
    <View>
      {line}
      <EventCommitList commits={event.commits} testID={`${testID}-commits`} />
    </View>
  );
}

function RunToggle({
  event,
  expanded,
  nowMs,
  onToggle,
  testID,
}: {
  readonly event: TimelineEvent;
  readonly expanded: boolean;
  readonly nowMs: number;
  readonly onToggle: () => void;
  readonly testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={event.text}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={testID}
    >
      <EventGlyphCircle event={event} />
      <EventSentence event={event} />
      <Text style={styles.age}>{compactAge(event.createdAt, nowMs)}</Text>
      <Ionicons
        color={colors.textMuted}
        name={expanded ? "chevron-up" : "chevron-down"}
        size={iconSize.inline}
      />
    </Pressable>
  );
}

function EventGlyphCircle({ event }: { readonly event: TimelineEvent }): React.JSX.Element {
  const tone = TONES[event.glyph.tone];
  return (
    <View style={[styles.circle, tone.surface]}>
      <Ionicons color={tone.color} name={event.glyph.icon} size={iconSize.inline} />
    </View>
  );
}

/** The actor's avatar, then the bold login and what happened, on one truncated line. */
function EventSentence({ event }: { readonly event: TimelineEvent }): React.JSX.Element {
  const { actor } = event;
  return (
    <>
      {actor === null ? null : <MessageAvatar author={messageAuthor(actor)} size="event" />}
      <Text numberOfLines={1} style={styles.text}>
        {actor === null ? null : <Text style={styles.actor}>{`${actor.login} `}</Text>}
        {event.text}
      </Text>
    </>
  );
}

const CIRCLE_SIZE = 28;

const styles = StyleSheet.create({
  actor: {
    color: colors.text,
    fontWeight: typeWeight.semibold,
  },
  age: {
    ...typeScale.label,
    color: colors.textDim,
    flexShrink: 0,
    marginLeft: spacing.xxs,
  },
  circle: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: CIRCLE_SIZE,
    justifyContent: "center",
    marginRight: spacing.xxs,
    width: CIRCLE_SIZE,
  },
  danger: {
    backgroundColor: colors.errorContainer,
  },
  neutral: {
    backgroundColor: colors.surfaceContainer,
  },
  pressed: {
    backgroundColor: colors.surfaceContainer,
  },
  // The page inset and the hairline above every row.
  row: {
    alignItems: "center",
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.touch + spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  success: {
    backgroundColor: colors.successContainer,
  },
  text: {
    ...typeScale.body,
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
  },
  warning: {
    backgroundColor: colors.warningContainer,
  },
});

const TONES: Readonly<Record<EventTone, { readonly color: string; readonly surface: ViewStyle }>> =
  {
    danger: { color: colors.error, surface: styles.danger },
    neutral: { color: colors.textMuted, surface: styles.neutral },
    success: { color: colors.success, surface: styles.success },
    warning: { color: colors.warning, surface: styles.warning },
  };
