import { Ionicons } from "@expo/vector-icons";
import { createElement, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { useEvent } from "../react/useEvent";
import {
  colors,
  controlHitSlop,
  controlSize,
  iconSize,
  layoutSize,
  menuContentInset,
  radii,
  spacing,
  typeScale,
} from "../theme";
import { CodeWideSlider } from "./CodeWideSlider.native";
import { ContentMenu } from "./ContentMenu";
import {
  fastServiceTier,
  isFastServiceTier,
  retainedServiceTier,
  STANDARD_SERVICE_TIER,
} from "./modelServiceTier";
import { AppText as Text } from "./Typography";
import type { ModelThinkingMenuProps, ModelSettingsChoice } from "./TurnControlMenus.types";

const MENU_WIDTH = 352;
const MIN_MENU_WIDTH = 1;
const MAX_VISIBLE_MODELS = 5;
const DISABLED_OPACITY = 0.45;

type ModelControl = ModelThinkingMenuProps["models"][number];
type ModelDraft = {
  readonly effort: string | null;
  readonly model: string | null;
  readonly personality: ModelThinkingMenuProps["selectedPersonality"];
  readonly serviceTier: string | null;
};
type MenuState =
  | { readonly status: "closed" }
  | {
      readonly draft: ModelDraft;
      readonly initial: ModelDraft;
      readonly modelsExpanded: boolean;
      readonly status: "open";
    };

function modelDraftFromProps(props: ModelThinkingMenuProps): ModelDraft {
  return {
    effort: props.selectedEffort,
    model: props.selectedModel,
    personality: props.selectedPersonality,
    serviceTier: props.selectedServiceTier,
  };
}

function modelDraftChanged(initial: ModelDraft, draft: ModelDraft): boolean {
  return (
    initial.model !== draft.model ||
    initial.effort !== draft.effort ||
    initial.serviceTier !== draft.serviceTier ||
    initial.personality !== draft.personality
  );
}

function modelDraftChoice(
  initial: ModelDraft,
  draft: ModelDraft,
  models: readonly ModelControl[],
): ModelSettingsChoice | null {
  const model = models.find((candidate) => candidate.id === draft.model);
  if (model === undefined || draft.effort === null) {
    return null;
  }
  if (!model.efforts.includes(draft.effort) && draft.effort !== model.defaultEffort) {
    return null;
  }
  return {
    effort: draft.effort,
    executionChanged:
      initial.model !== draft.model ||
      initial.effort !== draft.effort ||
      initial.serviceTier !== draft.serviceTier,
    model: model.id,
    personality: draft.personality,
    serviceTier: draft.serviceTier,
  };
}

/** Compose anchors the popup to the chip; the model list expands inside it. */
export function ModelThinkingSheet(props: ModelThinkingMenuProps): ReactNode {
  const [state, setState] = useState<MenuState>({ status: "closed" });
  const window = useWindowDimensions();
  const openMenu = useEvent(() => {
    const initial = modelDraftFromProps(props);
    setState({ draft: initial, initial, modelsExpanded: false, status: "open" });
    props.onOpen();
  });
  const onOpenChange = useEvent((next: boolean) => {
    if (!next && state.status === "open") {
      setState({ status: "closed" });
      props.onClose();
    }
  });
  const toggleModels = useEvent(() => {
    setState((current) =>
      current.status === "open" ? { ...current, modelsExpanded: !current.modelsExpanded } : current,
    );
  });
  const selectModel = useEvent((model: string, effort: string) => {
    setState((current) => {
      if (current.status !== "open") {
        return current;
      }
      const nextModel = props.models.find((candidate) => candidate.id === model);
      return {
        ...current,
        draft: {
          ...current.draft,
          effort,
          model,
          serviceTier:
            retainedServiceTier(current.draft.serviceTier, nextModel?.serviceTiers) ?? null,
        },
        modelsExpanded: false,
      };
    });
  });
  const selectEffort = useEvent((effort: string) => {
    setState((current) => {
      if (current.status !== "open" || current.draft.effort === effort) {
        return current;
      }
      return { ...current, draft: { ...current.draft, effort } };
    });
  });
  const selectPersonality = useEvent((personality: ModelDraft["personality"]) => {
    setState((current) =>
      current.status === "open"
        ? { ...current, draft: { ...current.draft, personality } }
        : current,
    );
  });
  const selectServiceTier = useEvent((serviceTier: string) => {
    setState((current) =>
      current.status === "open"
        ? { ...current, draft: { ...current.draft, serviceTier } }
        : current,
    );
  });
  const apply = useEvent(() => {
    if (state.status !== "open" || !modelDraftChanged(state.initial, state.draft)) {
      return;
    }
    const choice = modelDraftChoice(state.initial, state.draft, props.models);
    if (choice === null) {
      return;
    }
    props.onApplySettings(choice);
    setState({ status: "closed" });
    props.onClose();
  });
  const trigger = createElement(
    Pressable,
    {
      accessibilityLabel: props.accessibilityLabel,
      accessibilityRole: "button",
      onPress: openMenu,
      style: props.triggerStyle,
    },
    props.triggerChildren,
  );
  return (
    <ContentMenu
      onOpenChange={onOpenChange}
      open={state.status === "open"}
      trigger={trigger}
      width={Math.min(MENU_WIDTH, Math.max(MIN_MENU_WIDTH, window.width - spacing.lg))}
    >
      {state.status === "open" && (
        <ModelMenuContent
          apply={apply}
          draft={state.draft}
          initial={state.initial}
          modelsExpanded={state.modelsExpanded}
          onSelectEffort={selectEffort}
          onSelectModel={selectModel}
          onSelectPersonality={selectPersonality}
          onSelectServiceTier={selectServiceTier}
          onToggleModels={toggleModels}
          props={props}
        />
      )}
    </ContentMenu>
  );
}

function ModelMenuContent({
  apply,
  draft,
  initial,
  modelsExpanded,
  onSelectEffort,
  onSelectModel,
  onSelectPersonality,
  onSelectServiceTier,
  onToggleModels,
  props,
}: {
  apply: () => void;
  draft: ModelDraft;
  initial: ModelDraft;
  modelsExpanded: boolean;
  onSelectEffort: (effort: string) => void;
  onSelectModel: (model: string, effort: string) => void;
  onSelectPersonality: (personality: ModelDraft["personality"]) => void;
  onSelectServiceTier: (serviceTier: string) => void;
  onToggleModels: () => void;
  props: ModelThinkingMenuProps;
}): ReactNode {
  const model = props.models.find((candidate) => candidate.id === draft.model);
  const canApply =
    modelDraftChanged(initial, draft) && modelDraftChoice(initial, draft, props.models) !== null;
  return (
    <View style={styles.content}>
      <Text style={styles.title}>Model & Thinking</Text>
      <MenuNotices error={props.error} loading={props.loading && props.models.length === 0} />
      <ModelControls
        model={model}
        modelsExpanded={modelsExpanded}
        onSelectServiceTier={onSelectServiceTier}
        onToggleModels={onToggleModels}
        selectedServiceTier={draft.serviceTier}
      />
      {modelsExpanded && (
        <ModelChoices
          models={props.models}
          onChoose={onSelectModel}
          selectedEffort={draft.effort}
          selectedModel={draft.model}
        />
      )}
      {model?.supportsPersonality === true && (
        <PersonalityChoices onSelect={onSelectPersonality} selected={draft.personality} />
      )}
      {model !== undefined && (
        <CodeWideSlider
          accessibilityLabel="Thinking level"
          formatValue={effortLabel}
          key={model.id}
          onSelect={onSelectEffort}
          selected={draft.effort}
          testID="thinking-level"
          values={model.efforts.length > 0 ? model.efforts : [model.defaultEffort]}
        />
      )}
      <ApplyButton disabled={!canApply} onPress={apply} />
    </View>
  );
}

function MenuNotices({ error, loading }: { error: string | null; loading: boolean }): ReactNode {
  return (
    <>
      {error !== null && <Text style={styles.notice}>{error}</Text>}
      {loading && <Text style={styles.notice}>Loading models…</Text>}
    </>
  );
}

function ModelControls({
  model,
  modelsExpanded,
  onSelectServiceTier,
  onToggleModels,
  selectedServiceTier,
}: {
  model: ModelControl | undefined;
  modelsExpanded: boolean;
  onSelectServiceTier: (serviceTier: string) => void;
  onToggleModels: () => void;
  selectedServiceTier: string | null;
}): ReactNode {
  return (
    <View style={styles.modelControls}>
      <ModelDisclosure expanded={modelsExpanded} model={model} onPress={onToggleModels} />
      <FastToggle
        model={model}
        onSelectServiceTier={onSelectServiceTier}
        selectedServiceTier={selectedServiceTier}
      />
    </View>
  );
}

function ModelDisclosure({
  expanded,
  model,
  onPress,
}: {
  expanded: boolean;
  model: ModelControl | undefined;
  onPress: () => void;
}): ReactNode {
  return (
    <Pressable
      accessibilityLabel={`Choose model, ${model?.label ?? "unavailable"}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={styles.modelButton}
    >
      <Text numberOfLines={1} style={styles.rowText}>
        {model?.label ?? "Choose model"}
      </Text>
      <Ionicons
        color={colors.textMuted}
        name={expanded ? "chevron-up" : "chevron-down"}
        size={iconSize.inline}
      />
    </Pressable>
  );
}

function ModelChoices({
  models,
  onChoose,
  selectedEffort,
  selectedModel,
}: {
  models: readonly ModelControl[];
  onChoose: (model: string, effort: string) => void;
  selectedEffort: string | null;
  selectedModel: string | null;
}): ReactNode {
  return (
    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={styles.modelList}>
      {models.map((candidate) => (
        <ModelRow
          candidate={candidate}
          key={candidate.id}
          onChoose={onChoose}
          selected={candidate.id === selectedModel}
          selectedEffort={selectedEffort}
        />
      ))}
    </ScrollView>
  );
}

function ModelRow({
  candidate,
  onChoose,
  selected,
  selectedEffort,
}: {
  candidate: ModelControl;
  onChoose: (model: string, effort: string) => void;
  selected: boolean;
  selectedEffort: string | null;
}): ReactNode {
  const choose = useEvent(() => {
    const effort = candidate.efforts.includes(selectedEffort ?? "")
      ? (selectedEffort ?? candidate.defaultEffort)
      : candidate.defaultEffort;
    onChoose(candidate.id, effort);
  });
  return (
    <Pressable
      accessibilityLabel={candidate.label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={choose}
      style={styles.modelRow}
    >
      <Text style={styles.rowText}>{candidate.label}</Text>
      {selected && <Ionicons color={colors.text} name="checkmark" size={iconSize.inline} />}
    </Pressable>
  );
}

function FastToggle({
  model,
  onSelectServiceTier,
  selectedServiceTier,
}: {
  model: ModelControl | undefined;
  onSelectServiceTier: (serviceTier: string) => void;
  selectedServiceTier: string | null;
}): ReactNode {
  const fastTier = fastServiceTier(model?.serviceTiers);
  const enabled = fastTier !== undefined && isFastServiceTier(selectedServiceTier, fastTier);
  const toggle = useEvent(() => {
    if (fastTier !== undefined) {
      onSelectServiceTier(enabled ? STANDARD_SERVICE_TIER : fastTier.id);
    }
  });
  if (fastTier === undefined) {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel="Fast mode"
      accessibilityRole="switch"
      accessibilityState={{ checked: enabled }}
      onPress={toggle}
      style={[styles.fastButton, enabled && styles.fastButtonActive]}
    >
      <Ionicons
        color={enabled ? colors.onPrimary : colors.textMuted}
        name={enabled ? "flash" : "flash-outline"}
        size={iconSize.action}
      />
    </Pressable>
  );
}

function PersonalityChoices({
  onSelect,
  selected,
}: {
  onSelect: (personality: ModelDraft["personality"]) => void;
  selected: ModelThinkingMenuProps["selectedPersonality"];
}): ReactNode {
  return (
    <View style={styles.personalityRow}>
      {([null, "friendly", "pragmatic", "none"] as const).map((personality) => (
        <PersonalityChoice
          key={personality ?? "default"}
          onSelect={onSelect}
          personality={personality}
          selected={selected === personality}
        />
      ))}
    </View>
  );
}

function PersonalityChoice({
  onSelect,
  personality,
  selected,
}: {
  onSelect: (personality: ModelDraft["personality"]) => void;
  personality: ModelThinkingMenuProps["selectedPersonality"];
  selected: boolean;
}): ReactNode {
  const choose = useEvent(() => {
    onSelect(personality);
  });
  return (
    <Pressable
      accessibilityRole="button"
      onPress={choose}
      style={[styles.personalityChoice, selected && styles.personalitySelected]}
    >
      <Text style={styles.smallText}>{personality ?? "Default"}</Text>
    </Pressable>
  );
}

function ApplyButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }): ReactNode {
  return (
    <Pressable
      accessibilityLabel="Apply model settings"
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={controlHitSlop.regular}
      onPress={onPress}
      style={[styles.applyButton, disabled && styles.applyButtonDisabled]}
    >
      <Text style={styles.applyText}>Apply</Text>
    </Pressable>
  );
}

function effortLabel(value: string): string {
  if (value === "xhigh") {
    return "Extra high";
  }
  return value.length === 0 ? value : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

const styles = StyleSheet.create({
  applyButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  applyButtonDisabled: {
    opacity: DISABLED_OPACITY,
  },
  applyText: {
    ...typeScale.body,
    color: colors.onPrimary,
  },
  content: {
    paddingHorizontal: menuContentInset,
    paddingVertical: spacing.xs,
  },
  fastButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    height: layoutSize.header,
    justifyContent: "center",
    width: layoutSize.header,
  },
  fastButtonActive: {
    backgroundColor: colors.accent,
  },
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
  modelControls: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xs,
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
  notice: {
    ...typeScale.body,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  personalityChoice: {
    borderRadius: radii.small,
    padding: spacing.xs,
  },
  personalityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xxs,
    marginTop: spacing.md,
  },
  personalitySelected: {
    backgroundColor: colors.surfaceContainer,
  },
  rowText: {
    ...typeScale.title,
    color: colors.text,
    flexShrink: 1,
  },
  smallText: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
    marginBottom: spacing.sm,
  },
});
