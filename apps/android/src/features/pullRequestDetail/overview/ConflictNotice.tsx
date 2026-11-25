import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { PullRequestOverview } from "../../../data/forgePullRequestContract";
import { colors, iconSize, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { CatalogActionButton } from "../actions/CatalogActionButton";

/** Shows a forge-reported conflict beside its agent action, above the PR description. */
export function ConflictNotice({
  actions,
  onRun,
  overview,
  pending,
}: {
  readonly actions: readonly ActionDescriptor[];
  readonly onRun: (action: ActionDescriptor) => void;
  readonly overview: PullRequestOverview;
  readonly pending: Readonly<Record<string, true>>;
}): React.JSX.Element | null {
  if (
    overview.merge.state !== "conflicts" ||
    overview.state === "closed" ||
    overview.state === "merged"
  ) {
    return null;
  }
  return (
    <View style={styles.row}>
      <View style={styles.message}>
        <Ionicons color={colors.warning} name="warning-outline" size={iconSize.action} />
        <Text style={styles.label}>Conflicts with {overview.baseBranch}</Text>
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

const styles = StyleSheet.create({
  label: {
    ...typeScale.label,
    color: colors.warning,
    flexShrink: 1,
  },
  message: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    flexShrink: 1,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
});
