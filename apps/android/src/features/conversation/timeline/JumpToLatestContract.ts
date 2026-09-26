import type { TimelineJumpVisibility } from "./timelineJumpVisibility";

/** Visibility, placement, and action contract for the jump-to-latest control. */
export type JumpToLatestProps = {
  bottomChromeHeight: number;
  jumpTimelineToLatest: () => void;
  jumpVisibility: TimelineJumpVisibility;
  newItemCount: number;
};
