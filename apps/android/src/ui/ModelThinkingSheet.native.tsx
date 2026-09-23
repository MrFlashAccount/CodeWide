import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type GestureResponderEvent } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, iconSize, layoutSize, radii, spacing, touchTarget, typeScale } from "../theme";
import { AppSheet, AppSheetScrollView } from "./AppSheet";
import { fastServiceTier, isFastServiceTier, STANDARD_SERVICE_TIER } from "./modelServiceTier";
import { AppText as Text } from "./Typography";
import type { ModelThinkingMenuProps } from "./TurnControlMenus.types";

const TRACK_INSET = spacing.sm;
const THUMB_WIDTH = spacing.xs;
const DOT_SIZE = spacing.xxs;
const MIN_STOPS = 2;
const MAX_VISIBLE_MODELS = 6;

export function ModelThinkingSheet(props: ModelThinkingMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<"settings" | "models">("settings");
  const openSheet = useEvent(() => {
    setPage("settings");
    setOpen(true);
    props.onOpen();
  });
  const closeSheet = useEvent(() => {
    setOpen(false);
    props.onClose();
  });
  const onOpenChange = useEvent((next: boolean) => {
    if (!next) {
      closeSheet();
    }
  });
  const showModels = useEvent(() => {
    setPage("models");
  });
  const showSettings = useEvent(() => {
    setPage("settings");
  });
  const selectModel = useEvent((model: string, effort: string) => {
    props.onSelectModel(model, effort);
    setPage("settings");
  });
  const model = props.models.find((candidate) => candidate.id === props.selectedModel);
  return (
    <>
      <Pressable
        accessibilityLabel={props.accessibilityLabel}
        accessibilityRole="button"
        onPress={openSheet}
        style={props.triggerStyle}
      >
        {props.triggerChildren}
      </Pressable>
      <AppSheet
        contentProps={{ dismissLabel: "Close model settings" }}
        isOpen={open}
        onOpenChange={onOpenChange}
      >
        <SheetContent
          model={model}
          onBack={showSettings}
          onChoose={selectModel}
          onShowModels={showModels}
          page={page}
          props={props}
        />
      </AppSheet>
    </>
  );
}

type ModelControl = ModelThinkingMenuProps["models"][number];

function SheetContent({
  model,
  onBack,
  onChoose,
  onShowModels,
  page,
  props,
}: {
  model: ModelControl | undefined;
  onBack: () => void;
  onChoose: (model: string, effort: string) => void;
  onShowModels: () => void;
  page: "settings" | "models";
  props: ModelThinkingMenuProps;
}): ReactNode {
  return (
    <View style={styles.content}>
      <Text style={styles.title}>{page === "models" ? "Choose model" : "Model & Thinking"}</Text>
      {props.error !== null && <Text style={styles.notice}>{props.error}</Text>}
      {props.loading && props.models.length === 0 && (
        <Text style={styles.notice}>Loading models…</Text>
      )}
      {page === "models" ? (
        <ModelListPage {...props} onBack={onBack} onChoose={onChoose} />
      ) : (
        <ModelSettingsPage {...props} model={model} onShowModels={onShowModels} />
      )}
    </View>
  );
}

function ModelListPage({
  models,
  onBack,
  onChoose,
  onSelectPersonality,
  selectedEffort,
  selectedModel,
  selectedPersonality,
}: ModelThinkingMenuProps & {
  onBack: () => void;
  onChoose: (model: string, effort: string) => void;
}): ReactNode {
  const back = useEvent(onBack);
  const model = models.find((candidate) => candidate.id === selectedModel);
  return (
    <>
      <Pressable accessibilityRole="button" onPress={back} style={styles.backRow}>
        <Ionicons color={colors.text} name="chevron-back" size={iconSize.inline} />
        <Text style={styles.rowText}>Back</Text>
      </Pressable>
      <AppSheetScrollView style={styles.modelList}>
        {models.map((candidate) => (
          <ModelRow
            candidate={candidate}
            key={candidate.id}
            onChoose={onChoose}
            selected={candidate.id === selectedModel}
            selectedEffort={selectedEffort}
          />
        ))}
      </AppSheetScrollView>
      {model?.supportsPersonality === true && (
        <PersonalityChoices onSelect={onSelectPersonality} selected={selectedPersonality} />
      )}
    </>
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
      onPress={choose}
      style={styles.modelRow}
    >
      <Text style={styles.rowText}>{candidate.label}</Text>
      {selected && <Ionicons color={colors.text} name="checkmark" size={iconSize.inline} />}
    </Pressable>
  );
}

function PersonalityChoices({
  onSelect,
  selected,
}: {
  onSelect: ModelThinkingMenuProps["onSelectPersonality"];
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
  onSelect: ModelThinkingMenuProps["onSelectPersonality"];
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

function ModelSettingsPage({
  model,
  onSelectEffort,
  onSelectServiceTier,
  onShowModels,
  selectedEffort,
  selectedServiceTier,
}: ModelThinkingMenuProps & {
  model: ModelControl | undefined;
  onShowModels: () => void;
}): ReactNode {
  const fastTier = fastServiceTier(model?.serviceTiers);
  const efforts =
    model === undefined ? [] : model.efforts.length > 0 ? model.efforts : [model.defaultEffort];
  return (
    <>
      <Text style={styles.label}>Model</Text>
      <ModelControlRow
        fastTier={fastTier}
        model={model}
        onSelectServiceTier={onSelectServiceTier}
        onShowModels={onShowModels}
        selectedServiceTier={selectedServiceTier}
      />
      {efforts.length > 0 && (
        <ThinkingSlider efforts={efforts} onSelect={onSelectEffort} selected={selectedEffort} />
      )}
    </>
  );
}

function ModelControlRow({
  fastTier,
  model,
  onSelectServiceTier,
  onShowModels,
  selectedServiceTier,
}: {
  fastTier: NonNullable<ModelControl["serviceTiers"]>[number] | undefined;
  model: ModelControl | undefined;
  onSelectServiceTier: ModelThinkingMenuProps["onSelectServiceTier"];
  onShowModels: () => void;
  selectedServiceTier: string | null;
}): ReactNode {
  const showModels = useEvent(onShowModels);
  const fastEnabled = fastTier !== undefined && isFastServiceTier(selectedServiceTier, fastTier);
  const toggleFast = useEvent(() => {
    if (fastTier !== undefined) {
      onSelectServiceTier(fastEnabled ? STANDARD_SERVICE_TIER : fastTier.id);
    }
  });
  return (
    <View style={styles.modelControls}>
      <Pressable
        accessibilityLabel={`Choose model, ${model?.label ?? "unavailable"}`}
        accessibilityRole="button"
        onPress={showModels}
        style={styles.modelButton}
      >
        <Text numberOfLines={1} style={styles.rowText}>
          {model?.label ?? "Choose model"}
        </Text>
        <Ionicons color={colors.textMuted} name="chevron-forward" size={iconSize.inline} />
      </Pressable>
      {fastTier !== undefined && <FastToggle enabled={fastEnabled} onPress={toggleFast} />}
    </View>
  );
}

function FastToggle({ enabled, onPress }: { enabled: boolean; onPress: () => void }): ReactNode {
  const press = useEvent(onPress);
  return (
    <Pressable
      accessibilityLabel="Fast mode"
      accessibilityRole="switch"
      accessibilityState={{ checked: enabled }}
      onPress={press}
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

function ThinkingSlider({
  efforts,
  onSelect,
  selected,
}: {
  efforts: readonly string[];
  onSelect: (effort: string) => void;
  selected: string | null;
}): ReactNode {
  const [width, setWidth] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const selectedIndex = Math.max(0, efforts.indexOf(selected ?? efforts[0] ?? ""));
  const activeIndex = dragIndex ?? selectedIndex;
  const stopCount = Math.max(1, efforts.length - 1);
  const usableWidth = Math.max(0, width - TRACK_INSET * MIN_STOPS - THUMB_WIDTH);
  const indexAt = (event: GestureResponderEvent): number => {
    if (efforts.length < MIN_STOPS || usableWidth === 0) {
      return 0;
    }
    const position =
      (event.nativeEvent.locationX - TRACK_INSET - THUMB_WIDTH / MIN_STOPS) / usableWidth;
    return Math.max(0, Math.min(stopCount, Math.round(position * stopCount)));
  };
  const drag = useEvent((event: GestureResponderEvent) => {
    setDragIndex(indexAt(event));
  });
  const finish = useEvent((event: GestureResponderEvent) => {
    const effort = efforts[indexAt(event)];
    setDragIndex(null);
    if (effort !== undefined && effort !== selected) {
      onSelect(effort);
    }
  });
  const adjust = useEvent((direction: -1 | 1) => {
    const effort = efforts[Math.max(0, Math.min(stopCount, selectedIndex + direction))];
    if (effort !== undefined) {
      onSelect(effort);
    }
  });
  const onAccessibilityAction = useEvent((event: { nativeEvent: { actionName: string } }) => {
    adjust(event.nativeEvent.actionName === "increment" ? 1 : -1);
  });
  const onLayout = useEvent((event: { nativeEvent: { layout: { width: number } } }) => {
    setWidth(event.nativeEvent.layout.width);
  });
  const captureResponder = useEvent(() => true);
  const position = (index: number): number => (usableWidth * index) / stopCount;
  return (
    <View style={styles.thinkingSection}>
      <View style={styles.thinkingHeader}>
        <Text style={styles.label}>Thinking level</Text>
        <Text style={styles.currentLabel}>{effortLabel(efforts[activeIndex] ?? "")}</Text>
      </View>
      <View
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        accessibilityLabel={`Thinking level, ${effortLabel(efforts[activeIndex] ?? "")}`}
        accessibilityRole="adjustable"
        onAccessibilityAction={onAccessibilityAction}
        onLayout={onLayout}
        onMoveShouldSetResponder={captureResponder}
        onResponderGrant={drag}
        onResponderMove={drag}
        onResponderRelease={finish}
        onStartShouldSetResponder={captureResponder}
        style={styles.trackTouch}
      >
        <SliderTrack activeIndex={activeIndex} efforts={efforts} position={position} />
      </View>
      <View style={styles.endLabels}>
        <Text style={styles.smallText}>{effortLabel(efforts[0] ?? "")}</Text>
        <Text style={styles.smallText}>{effortLabel(efforts.at(-1) ?? "")}</Text>
      </View>
    </View>
  );
}

function SliderTrack({
  activeIndex,
  efforts,
  position,
}: {
  activeIndex: number;
  efforts: readonly string[];
  position: (index: number) => number;
}): ReactNode {
  return (
    <View style={styles.track}>
      <View
        style={[
          styles.trackFill,
          { backgroundColor: fillColor(activeIndex, efforts.length), width: position(activeIndex) },
        ]}
      />
      {efforts.map((effort, index) => (
        <View key={effort} style={[styles.dot, { left: position(index) }]} />
      ))}
      <View style={[styles.thumb, { left: position(activeIndex) }]} />
    </View>
  );
}

function fillColor(index: number, count: number): string {
  if (index * MIN_STOPS < count) {
    return colors.surfaceContainerHigh;
  }
  if (index < count - 1) {
    return colors.surfaceContainerHighest;
  }
  return colors.accentMuted;
}

function effortLabel(value: string): string {
  if (value === "xhigh") {
    return "Extra high";
  }
  return value.length === 0 ? value : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

const styles = StyleSheet.create({
  backRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: touchTarget,
  },
  content: {
    paddingBottom: spacing.lg,
  },
  currentLabel: {
    ...typeScale.body,
    color: colors.text,
  },
  dot: {
    backgroundColor: colors.textMuted,
    borderRadius: radii.pill,
    height: DOT_SIZE,
    position: "absolute",
    top: spacing.inputInset,
    width: DOT_SIZE,
  },
  endLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: TRACK_INSET,
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
  label: {
    ...typeScale.label,
    color: colors.textMuted,
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
    maxHeight: layoutSize.row * MAX_VISIBLE_MODELS,
  },
  modelRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.xs,
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
  thinkingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  thinkingSection: {
    marginTop: spacing.lg,
  },
  thumb: {
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    height: layoutSize.metadataRow + spacing.xxs,
    position: "absolute",
    top: -spacing.optical,
    width: THUMB_WIDTH,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  track: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.pill,
    height: layoutSize.metadataRow,
    marginHorizontal: TRACK_INSET,
    overflow: "hidden",
  },
  trackFill: {
    height: "100%",
  },
  trackTouch: {
    justifyContent: "center",
    minHeight: touchTarget,
  },
});
