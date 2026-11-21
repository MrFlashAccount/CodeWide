/**
 * The pure content of one-line timeline rows: who did what and when, under
 * which glyph, and the sentence a screen reader speaks for it.
 */
import type { ConversationAuthor } from "../../../data/forgeConversationContract";
import { compactAge } from "../../../ui/relativeAge";
import { eventGlyph, verdictGlyph, verdictPhrase, type EventGlyph } from "./conversationContent";
import type { EventEntry, ReviewEntry } from "./discussionModel";

/** What one timeline row says. */
export type TimelineEvent = {
  readonly actor: ConversationAuthor | null;
  readonly createdAt: string;
  readonly glyph: EventGlyph;
  /** What happened, after the actor's login: `approved these changes`. */
  readonly text: string;
};

const SPOKEN_MARKERS = { ai: ", AI", bot: ", Bot", user: "" } as const;

/** The row's spoken sentence, so the glyph's color and the avatar's shape are never the only signal. */
export function timelineEventLabel(event: TimelineEvent, nowMs: number): string {
  const age = compactAge(event.createdAt, nowMs);
  if (event.actor === null) {
    return `${event.text}, ${age}`;
  }
  return `${event.actor.login}${SPOKEN_MARKERS[event.actor.kind]} ${event.text}, ${age}`;
}

/** A review's verdict as a row: `dana approved these changes`. */
export function verdictEvent(review: ReviewEntry): TimelineEvent {
  return {
    actor: review.author,
    createdAt: review.createdAt,
    glyph: verdictGlyph(review.verdict),
    text: verdictPhrase(review.verdict),
  };
}

/** A forge event as a row: `olga.v uploaded iteration 2`. */
export function forgeEvent(event: EventEntry): TimelineEvent {
  return {
    actor: event.author,
    createdAt: event.createdAt,
    glyph: eventGlyph(event.category),
    text: event.text,
  };
}
