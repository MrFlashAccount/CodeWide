import type { ReactNode } from "react";
import { CatalogSearchPullProvider } from "../../presentation/input/CatalogSearchPullProvider";

/** Shares gesture progress between the catalog viewport and its fixed search row. */
export function ThreadListSearchPullProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return <CatalogSearchPullProvider>{children}</CatalogSearchPullProvider>;
}
