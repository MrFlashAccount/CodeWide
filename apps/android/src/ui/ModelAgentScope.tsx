import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { colors, iconSize, spacing, typeScale } from "../theme";
import { providerDisplayName } from "./providerBrand";
import { ProviderIcon } from "./ProviderIcon";
import type { ModelAgentScope } from "./TurnControlMenus.types";
import { AppText as Text } from "./Typography";

/** One line under the picker title of a new chat: its agent is fixed once the chat starts. */
export function ModelAgentNote({
  scope,
}: {
  readonly scope: ModelAgentScope | null | undefined;
}): ReactNode {
  if (scope === null || scope === undefined) {
    return null;
  }
  return (
    <Text style={styles.note} testID="model-agent-note">
      The agent can't be changed after the chat starts. To continue with another agent, fork the
      chat into it.
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
