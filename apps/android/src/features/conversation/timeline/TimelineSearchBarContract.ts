import type { Dispatch, SetStateAction } from "react";

/** Search query and match-navigation contract for a thread timeline. */
export type TimelineSearchBarProps = {
  closeThreadSearch: () => void;
  compact: boolean;
  moveThreadSearch: (delta: -1 | 1) => void;
  scrollToThreadSearchIndex: (index: number) => void;
  setThreadSearchMatch: Dispatch<SetStateAction<number>>;
  threadSearch: string;
  threadSearchMatch: number;
  threadSearchMatches: number[];
  updateThreadSearch: (value: string) => void;
};
