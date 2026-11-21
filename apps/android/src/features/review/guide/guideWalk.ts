/**
 * Pure walk order of a guide: chapters then stops, each stop's progress
 * (absent means pending) and the derived "changed after push" count.
 */
import type {
  GuideChapter,
  GuideState,
  GuideStop,
  ReviewGuide,
  StopProgressState,
} from "../../../data/reviewGuideContract";

/** One stop in reading order with its chapter. */
export type WalkStop = {
  readonly chapter: GuideChapter;
  readonly chapterIndex: number;
  readonly index: number;
  readonly stop: GuideStop;
};

/** Stops in reading order. */
export function walkStops(guide: ReviewGuide): readonly WalkStop[] {
  const stops: WalkStop[] = [];
  guide.chapters.forEach((chapter, chapterIndex) => {
    for (const stop of chapter.stops) {
      stops.push({ chapter, chapterIndex, index: stops.length, stop });
    }
  });
  return stops;
}

/** Progress of one stop. */
export function stopProgress(state: GuideState, stop: GuideStop): StopProgressState {
  return state.progress[stop.stopId] ?? "pending";
}

/** Stops whose hunks changed since the guide was written. */
export function changedStopCount(state: GuideState): number {
  return Object.values(state.progress).filter((value) => value === "changed").length;
}

/** First stop that still needs the reviewer, else the last one. */
export function resumeIndex(state: GuideState, stops: readonly WalkStop[]): number {
  const next = stops.find((entry) => {
    const progress = stopProgress(state, entry.stop);
    return progress === "pending" || progress === "changed";
  });
  return next?.index ?? Math.max(0, stops.length - 1);
}

/** The prose, else the summary; nothing when it would only repeat the stop title. */
export function stopNarration(stop: Pick<GuideStop, "prose" | "summary" | "title">): string | null {
  const text = stop.prose ?? stop.summary;
  return text.trim() === stop.title.trim() ? null : text;
}
