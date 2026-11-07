import { createContext, useContext } from "react";

export type AppListItemState = {
  readonly index: number;
  readonly isLast: boolean;
  readonly position: "only" | "first" | "middle" | "last";
};

const STANDALONE_ITEM_STATE: AppListItemState = {
  index: 0,
  isLast: true,
  position: "only",
};

/** Internal geometry channel shared by AppList and its rows. */
export const AppListItemContext = createContext<AppListItemState>(STANDALONE_ITEM_STATE);

/** Reads the index and grouped-row geometry owned by the nearest AppList item. */
export function useAppListItemState(): AppListItemState {
  return useContext(AppListItemContext);
}
