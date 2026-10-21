import { createElement, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";

import { useEvent } from "../react/useEvent";
import {
  colors,
  controlHitSlop,
  controlSize,
  menuContentInset,
  radii,
  spacing,
  typeScale,
} from "../theme";
import { CodeWideSlider } from "./CodeWideSlider.native";
import { ContentMenu } from "./ContentMenu";
import { FastModeToggle } from "./FastModeToggle";
import {
  fastServiceTier,
  isFastServiceTier,
  retainedServiceTier,
  STANDARD_SERVICE_TIER,
} from "./modelServiceTier";
import { ModelAgentNote } from "./ModelAgentScope";
import { ModelChoiceList, ModelDisclosure } from "./ModelChoiceList";
import { groupsModelsByProvider } from "./modelSections";
import { clampModelEffort, modelEffortLevels } from "./modelEffort";
import { modelEffortLabel } from "./modelEffortPresentation";
import { AppText as Text } from "./Typography";
import type { ModelThinkingMenuProps, ModelSettingsChoice } from "./TurnControlMenus.types";

const MENU_WIDTH = 352;
const MIN_MENU_WIDTH = 1;
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

/** The chosen model's name: its catalog row's, else the server's for the thread's model. */
function chosenModelLabel(
  model: ModelControl | undefined,
  draft: ModelDraft,
  props: ModelThinkingMenuProps,
): string | null {
  if (model !== undefined) {
    return model.label;
  }
  return draft.model === props.selectedModel ? (props.selectedModelLabel ?? null) : null;
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
  if (model === undefined || clampModelEffort(model, draft.effort) !== draft.effort) {
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
  const selectModel = useEvent((model: string, effort: string | null) => {
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
  onSelectModel: (model: string, effort: string | null) => void;
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
      <ModelAgentNote scope={props.agentScope} />
      <MenuNotices error={props.error} loading={props.loading && props.models.length === 0} />
      <ModelControls
        label={chosenModelLabel(model, draft, props)}
        model={model}
        modelsExpanded={modelsExpanded}
        onSelectServiceTier={onSelectServiceTier}
        onToggleModels={onToggleModels}
        selectedServiceTier={draft.serviceTier}
        showServiceTierControls={props.showServiceTierControls !== false}
      />
      {modelsExpanded && (
        <ModelChoiceList
          grouped={groupsModelsByProvider(props.agentScope)}
          models={props.models}
          onChoose={(candidate) => {
            onSelectModel(candidate.id, clampModelEffort(candidate, draft.effort));
          }}
          selectedModel={draft.model}
        />
      )}
      <OptionalPersonalityChoices
        model={model}
        onSelect={onSelectPersonality}
        selected={draft.personality}
        visible={props.showPersonalityControls !== false}
      />
      {model !== undefined && model.defaultEffort !== null && (
        <CodeWideSlider
          accessibilityLabel="Thinking level"
          formatValue={modelEffortLabel}
          key={model.id}
          onSelect={onSelectEffort}
          selected={draft.effort}
          testID="thinking-level"
          values={modelEffortLevels(model)}
        />
      )}
      <ApplyButton disabled={!canApply} onPress={apply} />
    </View>
  );
}

function OptionalPersonalityChoices({
  model,
  onSelect,
  selected,
  visible,
}: {
  readonly model: ModelControl | undefined;
  readonly onSelect: (personality: ModelDraft["personality"]) => void;
  readonly selected: ModelDraft["personality"];
  readonly visible: boolean;
}): ReactNode {
  if (!visible || model?.supportsPersonality !== true) {
    return null;
  }
  return <PersonalityChoices onSelect={onSelect} selected={selected} />;
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
  label,
  model,
  modelsExpanded,
  onSelectServiceTier,
  onToggleModels,
  selectedServiceTier,
  showServiceTierControls,
}: {
  /** The chosen model's name: its catalog row's, else the server's. */
  label: string | null;
  model: ModelControl | undefined;
  modelsExpanded: boolean;
  onSelectServiceTier: (serviceTier: string) => void;
  onToggleModels: () => void;
  selectedServiceTier: string | null;
  showServiceTierControls: boolean;
}): ReactNode {
  return (
    <View style={styles.modelControls}>
      <ModelDisclosure
        expanded={modelsExpanded}
        label={label}
        onPress={onToggleModels}
        provider={model?.provider ?? null}
      />
      {showServiceTierControls && (
        <FastToggle
          model={model}
          onSelectServiceTier={onSelectServiceTier}
          selectedServiceTier={selectedServiceTier}
        />
      )}
    </View>
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
  return <FastModeToggle enabled={enabled} onToggle={toggle} />;
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

const styles = StyleSheet.create({
  applyButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: controlSize.compact,
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
  modelControls: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xs,
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
