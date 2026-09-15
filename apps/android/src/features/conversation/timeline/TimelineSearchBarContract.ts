import type { Dispatch, SetStateAction } from "react";

/** Search query and match-navigation contract for a thread timeline. */
export type TimelineSearchBarProps = {
  threadSearch: string;
  updateThreadSearch: (value: string) => void;
  setThreadSearchMatch: Dispatch<SetStateAction<number>>;
  scrollToThreadSearchIndex: (index: number) => void;
  threadSearchMatches: number[];
  threadSearchMatch: number;
  compact: boolean;
  moveThreadSearch: (delta: -1 | 1) => void;
  closeThreadSearch: () => void;
};
