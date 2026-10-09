import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, iconSize, spacing, typeScale } from "../theme";
import { providerDisplayName } from "./providerBrand";
import { ProviderIcon } from "./ProviderIcon";
import type { ModelAgentScope } from "./TurnControlMenus.types";
import { AppText as Text } from "./Typography";

/** One line under the picker title that says which agent the conversation runs on. */
export function ModelAgentNote({
  scope,
}: {
  readonly scope: ModelAgentScope | null | undefined;
}): ReactNode {
  if (scope === null || scope === undefined) {
    return null;
  }
  const text =
    scope.kind === "newChat"
      ? "The agent can't be changed after the chat starts. To continue with another agent, fork the chat into it."
      : scope.canFork
        ? `This chat uses ${scope.providerName}. Fork it from the thread menu to switch agents.`
        : `This chat uses ${scope.providerName}.`;
  return (
    <Text style={styles.note} testID="model-agent-note">
      {text}
    </Text>
  );
}

/** Section header of one provider's models: its mark and name. */
export function ModelProviderHeader({ provider }: { readonly provider: string }): ReactNode {
  return (
    <View
      accessibilityRole="header"
      accessible
      style={styles.header}
      testID={`model-provider-section-${provider}`}
    >
      <ProviderIcon provider={provider} size={iconSize.inline} />
      <Text style={styles.headerText}>{providerDisplayName(provider)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  headerText: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  note: {
    ...typeScale.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
});
