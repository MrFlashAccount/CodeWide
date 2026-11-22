import { useLayoutEffect } from "react";
import { useEvent } from "../../src/react/useEvent";
import { useConversationRef, useConversationState } from "../../src/ui/use-conversation-scope";
import {
  savedReadingIndex,
  useThreadReadingPosition,
} from "../../src/features/conversation/timeline/threadReadingPosition";
import {
  timelineResponseStartRow,
  type TimelineRow,
} from "../../src/features/conversation/timeline/timelineRows";
import type { TimelineViewportProps } from "../../src/features/conversation/timeline/TimelineViewportContract";
import {
  conversationBottomContentInset,
  conversationTopContentInset,
} from "../../src/ui/conversation-chrome-layout";

type RowRange = { readonly first: string; readonly last: string; readonly target: string };
type Opening = ReturnType<typeof useThreadReadingPosition>;
type WindowState =
  | { readonly phase: "waiting" }
  | { readonly phase: "opening"; readonly range: RowRange }
  | { readonly phase: "full"; readonly remount: boolean };

function initialRange(
  rows: readonly TimelineRow[],
  reading: Opening,
  unread: string | null,
  mode: string,
): RowRange | null {
  if (!reading || reading.opening.kind === "pending" || rows.length <= 8) return null;
  const opening = reading.opening;
  if (mode === "anchor-present" && (opening.kind !== "tail" || unread !== null)) return null;
  const saved = opening.kind === "saved" ? savedReadingIndex(rows, opening.bookmark) : undefined;
  const unreadId = opening.kind === "unread" ? opening.turnId : unread;
  const response = unreadId ? timelineResponseStartRow(rows, unreadId) : null;
  if ((opening.kind === "saved" && !saved) || (opening.kind === "unread" && !response)) return null;
  const focused = saved?.index ?? response?.index;
  const anchor = focused ?? rows.length - 1;
  const target = rows[anchor];
  if (!target) return null;
  let lo = Math.max(0, anchor - 2);
  let end = Math.min(rows.length, anchor + 6);
  if (focused === undefined) {
    lo = anchor;
    while (lo > 0 && anchor - lo < 5 && rows[lo - 1]?.timelineIndex === target.timelineIndex) lo--;
    end = rows.length;
  }
  const first = rows[lo];
  const last = rows[end - 1];
  return first && last ? { first: first.key, last: last.key, target: target.key } : null;
}

/** Supplies a provisional LegendList range in the opt-in emulator benchmark. */
export function useOpeningWindow(
  props: TimelineViewportProps,
  rows: TimelineRow[],
  reading: Opening,
  mode: string,
  mark: (s: string) => void,
  afterFrame: () => Promise<boolean>,
) {
  const enabled =
    (mode === "anchor-present" || mode === "anchor-window" || mode === "anchor-edge") &&
    !props.threadSearchActive &&
    !props.newChat &&
    !props.timelineJumpRequest;
  const [state, setState] = useConversationState<WindowState>(props.composerScope, () => ({
    phase: "waiting",
  }));
  const candidate =
    enabled && state.phase === "waiting"
      ? initialRange(rows, reading, props.latestUnreadAgentTurnId, mode)
      : null;
  if (candidate) setState({ phase: "opening", range: candidate });
  const bounds = state.phase === "opening" ? state.range : candidate;
  const first = enabled && bounds ? rows.findIndex((row) => row.key === bounds.first) : -1;
  const last = first >= 0 && bounds ? rows.findIndex((r) => r.key === bounds.last) : -1;
  const partial = first >= 0 && last >= first && (first > 0 || last < rows.length - 1);
  if (state.phase === "opening" && !partial) setState({ phase: "full", remount: false });
  const shown = partial ? rows.slice(first, last + 1) : rows;
  const sizes = useConversationRef(props.composerScope, () => new Map<string, number>());
  const remember = useEvent((key: string, height: number) => {
    if (partial) sizes.current.set(key, height);
  });
  const expand = useEvent(() => {
    if (partial) {
      mark("grow." + first + "." + last + "." + rows.length);
      setState({ phase: "full", remount: false });
    }
  });
  const ready = useEvent((next: () => void) => {
    if (partial && bounds) {
      const target = shown.findIndex((r) => r.key === bounds.target);
      const needed =
        props.timelineViewportHeightRef.current -
        conversationTopContentInset(props.threadSearchVisible) -
        conversationBottomContentInset(props.bottomChromeHeight, props.liveStatusVisible);
      let observed = 0;
      let availableAfter = 0;
      for (const [index, row] of shown.entries()) {
        const height = sizes.current.get(row.key) ?? 0;
        observed += height;
        if (index >= target) availableAfter += height;
      }
      mark(
        "openRange." +
          first +
          "." +
          last +
          "." +
          rows.length +
          "." +
          Math.round(observed) +
          "." +
          Math.round(needed),
      );
      // Remeasure the complete data while still hidden if a provisional edge would be exposed.
      // A saved point can sit arbitrarily far into a tall row.
      const savedTop =
        reading?.opening.kind === "saved" ? Math.min(0, reading.opening.bookmark.top) : 0;
      if (
        needed <= 0 ||
        observed < needed ||
        (last < rows.length - 1 && availableAfter + savedTop < needed)
      ) {
        mark("refill");
        setState({ phase: "full", remount: true });
        return;
      }
    }
    next();
  });
  useLayoutEffect(() => {
    if (!partial || !props.timelinePositioned || mode === "anchor-edge") return;
    if (mode === "anchor-present") {
      let active = true;
      const finish = (committed: boolean) => {
        if (active) {
          mark(committed ? "committedFrame" : "frameTimeout");
          expand();
        }
      };
      void afterFrame().then(finish, () => finish(false));
      return () => {
        active = false;
      };
    }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(expand);
    });
    return () => cancelAnimationFrame(frame);
  }, [expand, partial, props.timelinePositioned, mode, afterFrame, mark]);
  return {
    rows: shown,
    partial,
    first,
    last,
    remember,
    ready,
    expand,
    remount: state.phase === "full" && state.remount,
  };
}
