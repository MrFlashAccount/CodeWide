import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, controlHitSlop, iconSize, spacing, typeScale } from "../theme";
import { providerDisplayName } from "./providerBrand";
import { ProviderIcon } from "./ProviderIcon";
import type { ModelAgentScope } from "./TurnControlMenus.types";
import { AppText as Text } from "./Typography";

/**
 * One line under the picker title that says which agent the conversation runs
 * on; a thread that can fork into another agent also offers that fork.
 * `onFork` runs before the scope's own fork action, e.g. to close the picker.
 */
export function ModelAgentNote({
  onFork,
  scope,
}: {
  readonly onFork?: () => void;
  readonly scope: ModelAgentScope | null | undefined;
}): ReactNode {
  if (scope === null || scope === undefined) {
    return null;
  }
  if (scope.kind === "newChat") {
    return (
      <Text style={styles.note} testID="model-agent-note">
        The agent can't be changed after the chat starts. To continue with another agent, fork the
        chat into it.
      </Text>
    );
  }
  const forkIntoAgent = scope.forkIntoAgent;
  if (forkIntoAgent === null) {
    return (
      <Text style={styles.note} testID="model-agent-note">
        {`This chat uses ${scope.providerName}.`}
      </Text>
    );
  }
  return (
    <View style={styles.forkNote}>
      <Text style={styles.forkNoteText} testID="model-agent-note">
        {`This chat uses ${scope.providerName}. Fork it to switch agents.`}
      </Text>
      <Pressable
        accessibilityLabel="Fork into another agent"
        accessibilityRole="button"
        hitSlop={controlHitSlop.regular}
        onPress={() => {
          onFork?.();
          forkIntoAgent();
        }}
        testID="model-agent-fork"
      >
        <Text style={styles.forkAction}>Fork…</Text>
      </Pressable>
    </View>
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
  forkAction: {
    ...typeScale.label,
    color: colors.accent,
  },
  forkNote: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  forkNoteText: {
    ...typeScale.label,
    color: colors.textMuted,
    flexShrink: 1,
  },
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
