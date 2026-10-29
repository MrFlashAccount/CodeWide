import { RowActionTrigger } from "../../ui/RowActionTrigger";
import { catalogRowFrameStyles } from "../../ui/CatalogRow.styles";
import type { ThreadRowLinkTriggerProps } from "./ThreadRowLinkTrigger.types";

/** Applies session layout to the shared scroll-safe row activation mechanism. */
export function ThreadRowLinkTrigger({
  selected,
  swipeEnabled,
  ...props
}: ThreadRowLinkTriggerProps): React.JSX.Element {
  return (
    <RowActionTrigger
      {...props}
      gestureTestId="thread-row"
      style={[
        catalogRowFrameStyles.frame,
        swipeEnabled && catalogRowFrameStyles.swipeChild,
        selected && catalogRowFrameStyles.selected,
      ]}
    />
  );
}
