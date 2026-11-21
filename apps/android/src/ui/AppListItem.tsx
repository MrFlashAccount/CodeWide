import { useAppListItemState } from "./appListItemContext";
import { AppListRow } from "./AppListRow";
import type { AppListRowProps } from "./AppListRow.types";

type AppListItemProps = AppListRowProps & { readonly position?: never };

/** A grouped row whose geometry is owned by its nearest AppList item. */
export function AppListItem(row: AppListItemProps): React.JSX.Element {
  const { position } = useAppListItemState();
  return <AppListRow {...row} position={position} />;
}
