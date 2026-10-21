import { View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { CatalogActionButton } from "../actions/CatalogActionButton";
import { OverflowActionsMenu, type ExtraMenuItem } from "../actions/OverflowActionsMenu";
import type { ActionSlots } from "../actions/actionSlotting";
import { overviewStyles as styles } from "./overview.styles";

/** Header action row: slotted primaries, secondaries and the ⋯ overflow, on one line. */
export function ActionRow({
  extra,
  onLayoutWidth,
  onRun,
  pending,
  slots,
}: {
  readonly extra: readonly ExtraMenuItem[];
  readonly onLayoutWidth: (width: number) => void;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
  readonly slots: Pick<ActionSlots, "overflow" | "primary" | "secondary">;
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
      <View style={styles.fill} />
      <OverflowActionsMenu
        accessibilityLabel="More pull request actions"
        actions={slots.overflow}
        extra={extra}
        onRun={onRun}
      />
    </View>
  );
}
