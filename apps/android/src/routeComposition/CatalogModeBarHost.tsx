import { CatalogModeBar, type CatalogMode } from "../features/pullRequests/CatalogModeBar";

/** Always-mounted catalog bottom bar bound to the owning workspace navigator. */
export function CatalogModeBarHost({
  mode,
  onSelect,
}: {
  readonly mode: CatalogMode;
  readonly onSelect: (mode: CatalogMode) => void;
}): React.JSX.Element {
  return <CatalogModeBar mode={mode} onSelect={onSelect} />;
}
