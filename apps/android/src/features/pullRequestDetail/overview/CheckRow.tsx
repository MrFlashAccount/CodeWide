import { View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { CheckItem } from "../../../data/forgePullRequestContract";
import { AppText as Text } from "../../../ui/Typography";
import { CatalogActionButton } from "../actions/CatalogActionButton";
import { OverflowActionsMenu } from "../actions/OverflowActionsMenu";
import { checkStatusLine } from "./checkPresentation";
import { overviewStyles as styles } from "./overview.styles";

const GLYPHS: Readonly<Record<CheckItem["state"], string>> = {
  cancelled: "✕",
  failed: "✕",
  passed: "✓",
  pending: "●",
  skipped: "✓",
};

/** One check with its glyph, status line and anchored actions (a compact first action, the rest behind ⋯). */
export function CheckRow({
  actions,
  item,
  onRun,
  pending,
}: {
  readonly actions: readonly ActionDescriptor[];
  readonly item: CheckItem;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
}): React.JSX.Element {
  const [first, ...rest] = actions;
  const failed = item.state === "failed" || item.state === "cancelled";
  return (
    <View style={styles.cardLine} testID={`check-row-${item.checkId}`}>
      <Text style={[styles.body, failed ? styles.danger : styles.success]}>
        {GLYPHS[item.state]}
      </Text>
      <View style={styles.lineBody}>
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.body}>
          {item.name}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {checkStatusLine(item)}
        </Text>
      </View>
      {first === undefined ? null : (
        <CatalogActionButton
          action={first}
          onPress={onRun}
          pending={pending[first.actionId] === true}
          variant="compact"
        />
      )}
      <OverflowActionsMenu
        accessibilityLabel={`More actions for ${item.name}`}
        actions={rest}
        compact
        onRun={onRun}
      />
    </View>
  );
}
