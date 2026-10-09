import { RowActionTrigger } from "../../ui/RowActionTrigger";
import { styles } from "./ThreadRow.styles";
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
        styles.threadRow,
        swipeEnabled && styles.threadRowSwipeChild,
        selected && styles.threadRowSelected,
      ]}
    />
  );
}
