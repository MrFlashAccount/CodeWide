import { View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { CatalogActionButton } from "../actions/CatalogActionButton";
import type { ActionSlots } from "../actions/actionSlotting";
import { overviewStyles as styles } from "./overview.styles";

/**
 * Header row of forge actions: slotted primaries and secondaries on one line; the rest go to
 * the app bar ⋯. Agent scenarios placed in the row show in the Agent section below instead.
 */
export function ActionRow({
  onLayoutWidth,
  onRun,
  pending,
  slots,
}: {
  readonly onLayoutWidth: (width: number) => void;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
  readonly slots: Pick<ActionSlots, "primary" | "secondary">;
}): React.JSX.Element {
  return (
    <View
      onLayout={(event) => {
        onLayoutWidth(event.nativeEvent.layout.width);
      }}
      style={styles.row}
      testID="pull-request-action-row"
    >
      {slots.primary.map((action) => (
        <CatalogActionButton
          action={action}
          key={action.actionId}
          onPress={onRun}
          pending={pending[action.actionId] === true}
          variant="primary"
        />
      ))}
      {slots.secondary.map((action) => (
        <CatalogActionButton
          action={action}
          key={action.actionId}
          onPress={onRun}
          pending={pending[action.actionId] === true}
          variant="secondary"
        />
      ))}
    </View>
  );
}
