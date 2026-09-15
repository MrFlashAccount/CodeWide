/** Visibility, placement, and action contract for the jump-to-latest control. */
export type JumpToLatestProps = {
  newItemCount: number;
  bottomChromeHeight: number;
  jumpTimelineToLatest: () => void;
};
