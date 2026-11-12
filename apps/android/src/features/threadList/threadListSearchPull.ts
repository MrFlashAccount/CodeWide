import { useCatalogSearchPullGesture } from "../../presentation/input/catalogSearchPullModel";

export { useCatalogSearchPullModel as useThreadListSearchPullModel } from "../../presentation/input/catalogSearchPullModel";
export type { CatalogSearchPullModel as ThreadListSearchPullModel } from "../../presentation/input/catalogSearchPullModel";

export function useThreadListPullGesture(
  onOpenSearch: () => void,
  initialOffset: number,
  scope: string,
): ReturnType<typeof useCatalogSearchPullGesture> {
  return useCatalogSearchPullGesture({
    enabled: true,
    gestureTestID: "thread-list-pull-to-search",
    initialOffset,
    onOpenSearch,
    scope,
  });
}
