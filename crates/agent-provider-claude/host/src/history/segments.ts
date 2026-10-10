/**
 * Groups classified history entries into turns. Claude's store has no
 * explicit turn boundaries, so they are derived:
 * - the first persisted message of a turn the host drove starts that turn
 *   (the turn index knows it);
 * - a prompt starts a user turn, unless the turn index knows it as a steer
 *   or a resent first prompt inside the current turn, or Claude queued it
 *   while a turn ran (a prompt typed while the agent was busy);
 * - a wake message starts a provider turn, unless Claude queued it while a
 *   turn ran (a notification delivered into the running turn);
 * - an interrupt marker ends the current turn as interrupted;
 * - an agent frame or a compaction with no open turn starts a provider turn
 *   (for example, a background task finishing after the turn ended).
 * Pure; no I/O.
 */

import type { TurnOrigin } from "../protocol.js";
import type { HistoryEntry } from "./entries.js";

export interface HistorySegment {
  /** Entries of the turn in order; a user turn starts with its prompt. */
  readonly entries: readonly HistoryEntry[];
  /** Ended by an interrupt marker. */
  readonly interrupted: boolean;
  readonly origin: TurnOrigin;
}

/** What the turn index tells the segmentation. */
export interface SegmentHints {
  /** Prompts that continue the open turn (steers, a first prompt resent to a new session). */
  readonly continuations: ReadonlySet<string>;
  /** First persisted message of each host-driven turn, with the turn's origin. */
  readonly starts: ReadonlyMap<string, TurnOrigin>;
}

interface OpenSegment {
  readonly entries: HistoryEntry[];
  interrupted: boolean;
  readonly origin: TurnOrigin;
}

class Segmenter {
  private readonly segments: OpenSegment[] = [];
  private open: OpenSegment | null = null;
  private readonly hints: SegmentHints;

  public constructor(hints: SegmentHints) {
    this.hints = hints;
  }

  private start(origin: TurnOrigin, first: HistoryEntry | null): void {
    this.open = { entries: first === null ? [] : [first], interrupted: false, origin };
    this.segments.push(this.open);
  }

  /** Appends to the open turn, or starts a turn of `origin` with the entry. */
  private append(entry: HistoryEntry, origin: TurnOrigin): void {
    if (this.open === null) {
      this.start(origin, entry);
    } else {
      this.open.entries.push(entry);
    }
  }

  /** A prompt continues the open turn when the index says so or Claude queued it into a running turn. */
  private prompt(entry: Extract<HistoryEntry, { readonly kind: "prompt" }>): void {
    if (this.hints.continuations.has(entry.uuid) || (entry.queued && this.open !== null)) {
      this.append(entry, "user");
    } else {
      this.start("user", entry);
    }
  }

  /** A wake starts a provider turn unless Claude delivered it into a running turn. */
  private wake(entry: Extract<HistoryEntry, { readonly kind: "wake" }>): void {
    if (!entry.queued || this.open === null) {
      this.start("provider", null);
    }
  }

  public add(entry: HistoryEntry): void {
    const indexedStart = this.hints.starts.get(entry.uuid);
    if (indexedStart !== undefined && this.open?.entries[0]?.uuid !== entry.uuid) {
      this.start(indexedStart, entry);
      return;
    }
    switch (entry.kind) {
      case "prompt":
        this.prompt(entry);
        return;
      case "wake":
        this.wake(entry);
        return;
      case "interrupt":
        if (this.open !== null) {
          this.open.interrupted = true;
          this.open = null;
        }
        return;
      case "compaction":
      case "frame":
        this.append(entry, "provider");
        return;
    }
  }

  public result(): readonly HistorySegment[] {
    return this.segments.filter((segment) => segment.entries.length > 0);
  }
}

/** Splits entries into turn segments. */
export function historySegments(
  entries: readonly HistoryEntry[],
  hints: SegmentHints,
): readonly HistorySegment[] {
  const segmenter = new Segmenter(hints);
  for (const entry of entries) {
    segmenter.add(entry);
  }
  return segmenter.result();
}
