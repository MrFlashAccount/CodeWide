import { CatalogSearchPullBackdrop } from "../../presentation/input/CatalogSearchPullBackdrop";

/** The list darkens progressively during a pull while its fixed search row remains visible. */
export function ThreadListPullBackdrop(): React.JSX.Element {
  return <CatalogSearchPullBackdrop testID="thread-list-pull-backdrop" />;
}
