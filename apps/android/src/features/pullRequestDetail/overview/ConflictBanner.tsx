import { View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { AppText as Text } from "../../../ui/Typography";
import { CatalogActionButton } from "../actions/CatalogActionButton";
import { overviewStyles as styles } from "./overview.styles";

/** Merge conflicts with the base branch, with the actions anchored to the conflict. */
export function ConflictBanner({
  actions,
  baseBranch,
  onRun,
  pending,
  reason,
}: {
  readonly actions: readonly ActionDescriptor[];
  readonly baseBranch: string;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
  readonly reason: string | null;
}): React.JSX.Element {
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, styles.bannerWarning, styles.row]}
      testID="pull-request-conflict-banner"
    >
      <View style={styles.lineBody}>
        <Text style={styles.title}>{`! Conflicts with ${baseBranch}`}</Text>
        {reason === null ? null : <Text style={styles.meta}>{reason}</Text>}
      </View>
      {actions.map((action) => (
        <CatalogActionButton
          action={action}
          key={action.actionId}
          onPress={onRun}
          pending={pending[action.actionId] === true}
          variant="compact"
        />
      ))}
    </View>
  );
}
