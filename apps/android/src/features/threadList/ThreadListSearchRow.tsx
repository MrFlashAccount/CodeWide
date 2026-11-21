import { CatalogSearchRow } from "../../presentation/input/CatalogSearchRow";

/** The fixed list header keeps search available while the catalog scrolls. */
export function ThreadListSearchRow({
  onOpenSearch,
}: {
  readonly onOpenSearch: () => void;
}): React.JSX.Element {
  return (
    <CatalogSearchRow
      accessibilityLabel="Search threads and messages"
      onOpenSearch={onOpenSearch}
      placeholder="Search threads and messages"
      testID="thread-search-row"
    />
  );
}
