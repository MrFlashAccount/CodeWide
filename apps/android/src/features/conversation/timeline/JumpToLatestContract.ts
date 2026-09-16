/** Visibility, placement, and action contract for the jump-to-latest control. */
export type JumpToLatestProps = {
  bottomChromeHeight: number;
  jumpTimelineToLatest: () => void;
  newItemCount: number;
};
