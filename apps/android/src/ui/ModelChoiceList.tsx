/**
 * The model selection rows shared by every model picker: a disclosure that shows
 * the chosen model and the list it expands. Rows of a provider-aware catalog
 * carry their provider's mark and may be grouped under provider headers.
 */
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, iconSize, layoutSize, radii, spacing, typeScale } from "../theme";
import { ModelProviderHeader } from "./ModelAgentScope";
import { modelSections } from "./modelSections";
import { ProviderIcon } from "./ProviderIcon";
import { AppText as Text } from "./Typography";

const MAX_VISIBLE_MODELS = 5;

/** What one model row shows. */
type ModelChoiceRow = {
  readonly id: string;
  readonly label: string;
  /** Provider of a provider-aware catalog row (its mark); `null` or absent for a legacy catalog. */
  readonly provider?: string | null;
};

/**
 * The collapsed model row: the chosen model led by its provider's mark. `label`
 * is `null` when no model is chosen. Without `onPress` it only shows the model.
 */
export function ModelDisclosure({
  expanded,
  label,
  onPress,
  provider,
}: {
  readonly expanded: boolean;
  readonly label: string | null;
  readonly onPress: (() => void) | null;
  readonly provider: string | null;
}): ReactNode {
  return (
    <Pressable
      accessibilityLabel={`Choose model, ${label ?? "unavailable"}`}
      accessibilityRole="button"
      accessibilityState={onPress === null ? { disabled: true, expanded } : { expanded }}
      onPress={onPress ?? undefined}
      style={styles.modelButton}
    >
      <ModelLabel label={label ?? "Choose model"} provider={provider} />
      {onPress !== null && (
        <Ionicons
          color={colors.textMuted}
          name={expanded ? "chevron-up" : "chevron-down"}
          size={iconSize.inline}
        />
      )}
    </Pressable>
  );
}

/** The expanded model list; `grouped` puts each provider's rows under its header. */
export function ModelChoiceList<Model extends ModelChoiceRow>({
  grouped,
  models,
  onChoose,
  selectedModel,
}: {
  readonly grouped: boolean;
  readonly models: readonly Model[];
  readonly onChoose: (model: Model) => void;
  readonly selectedModel: string | null;
}): ReactNode {
  const row = (candidate: Model) => (
    <ModelChoiceItem
      candidate={candidate}
      key={`${candidate.provider ?? ""}:${candidate.id}`}
      onChoose={onChoose}
      selected={candidate.id === selectedModel}
    />
  );
  return (
    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={styles.modelList}>
      {grouped
        ? modelSections(models).map((section) => (
            <View key={section.provider ?? "unannotated"}>
              {section.provider !== null && <ModelProviderHeader provider={section.provider} />}
              {section.models.map(row)}
            </View>
          ))
        : models.map(row)}
    </ScrollView>
  );
}

function ModelChoiceItem<Model extends ModelChoiceRow>({
  candidate,
  onChoose,
  selected,
}: {
  readonly candidate: Model;
  readonly onChoose: (model: Model) => void;
  readonly selected: boolean;
}): ReactNode {
  const choose = useEvent(() => {
    onChoose(candidate);
  });
  return (
    <Pressable
      accessibilityLabel={candidate.label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={choose}
      style={styles.modelRow}
    >
      <ModelLabel label={candidate.label} provider={candidate.provider ?? null} />
      {selected && <Ionicons color={colors.text} name="checkmark" size={iconSize.inline} />}
    </Pressable>
  );
}

/** A model's label, led by its provider's mark in a provider-aware catalog. */
function ModelLabel({
  label,
  provider,
}: {
  readonly label: string;
  readonly provider: string | null;
}): ReactNode {
  return (
    <View style={styles.modelLabel}>
      {provider !== null && <ProviderIcon provider={provider} size={iconSize.inline} />}
      <Text numberOfLines={1} style={styles.rowText}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  modelButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.md,
  },
  modelLabel: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.xs,
  },
  modelList: {
    marginTop: spacing.xs,
    maxHeight: layoutSize.header * MAX_VISIBLE_MODELS,
  },
  modelRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.sm,
  },
  rowText: {
    ...typeScale.title,
    color: colors.text,
    flexShrink: 1,
  },
});
