/** The "Fork chat" sheet: who continues the chat, with which model, thinking level and Fast. */
import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactElement, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import type {
  ThreadForkBoundary,
  ThreadForkOptions,
  ThreadForkTarget,
} from "../../data/thread-fork";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { useAppDialog } from "../../ui/AppDialog";
import { AppSheet } from "../../ui/AppSheet";
import { FastModeToggle } from "../../ui/FastModeToggle";
import { ModelChoiceList, ModelDisclosure } from "../../ui/ModelChoiceList";
import { clampModelEffort, modelEffortLevels } from "../../ui/modelEffort";
import { modelEffortLabel } from "../../ui/modelEffortPresentation";
import { fastServiceTier } from "../../ui/modelServiceTier";
import { providerDisplayName } from "../../ui/providerBrand";
import { ProviderIcon } from "../../ui/ProviderIcon";
import { ThinkingLevelSlider } from "../../ui/ThinkingLevelSlider";
import { AppText as Text } from "../../ui/Typography";
import type { ForkRequest, ForkTargetPicker } from "./forkTargetPicker";
import {
  forkAgentModels,
  forkAgents,
  forkAgentSelection,
  forkFastEnabled,
  forkFastSelection,
  forkModelSelection,
  forkTarget,
  initialForkSelection,
  type ForkAgent,
  type ForkModel,
  type ForkOffer,
  type ForkSelection,
} from "./forkTargets";
import { styles } from "./ThreadActions.styles";

/** Renders the conversation's open "Fork chat" sheet; confirming it forks through `onFork`. */
export function ThreadForkSheet({
  onFork,
  picker,
}: {
  readonly onFork: (options: ThreadForkOptions) => Promise<void>;
  readonly picker: ForkTargetPicker;
}): ReactElement | null {
  const dialog = useAppDialog();
  const request = picker.request;
  const confirm = useEvent((target: ThreadForkTarget | null) => {
    if (request === null) {
      return;
    }
    picker.closeFork();
    void onFork({ boundary: request.boundary, ephemeral: false, target }).catch(
      (error: unknown) => {
        dialog.alert(
          "Fork failed",
          error instanceof Error ? error.message : "Thread action failed",
        );
      },
    );
  });
  if (request === null) {
    return null;
  }
  return (
    <ForkSheetContent
      key={
        request.boundary.kind === "all"
          ? "all"
          : `${request.boundary.kind}:${request.boundary.turnId}`
      }
      onClose={picker.closeFork}
      onConfirm={confirm}
      request={request}
    />
  );
}

function ForkSheetContent({
  onClose,
  onConfirm,
  request,
}: {
  readonly onClose: () => void;
  readonly onConfirm: (target: ThreadForkTarget | null) => void;
  readonly request: ForkRequest;
}): ReactElement {
  const offer = request.offer;
  const [selection, setSelection] = useState<ForkSelection | null>(() =>
    initialForkSelection(offer),
  );
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const chooseAgent = useEvent((agent: ForkAgent) => {
    const next = forkAgentSelection(offer, agent.provider);
    if (next !== null) {
      setSelection(next);
      setModelsExpanded(false);
    }
  });
  const toggleModels = useEvent(() => {
    setModelsExpanded((current) => !current);
  });
  const chooseModel = useEvent((model: ForkModel) => {
    setSelection((current) =>
      current === null ? null : forkModelSelection(offer, current, model),
    );
    setModelsExpanded(false);
  });
  const chooseEffort = useEvent((effort: string) => {
    setSelection((current) => (current === null ? null : { ...current, effort }));
  });
  const toggleFast = useEvent(() => {
    setSelection((current) =>
      current === null ? null : forkFastSelection(current, !forkFastEnabled(current)),
    );
  });
  const fork = useEvent(() => {
    if (selection !== null) {
      onConfirm(forkTarget(offer, selection));
    }
  });
  return (
    <AppSheet
      contentProps={{ enableDynamicSizing: true, index: 0 }}
      isOpen
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <View style={styles.forkSheet} testID="fork-sheet">
        <ForkHeader boundary={request.boundary} />
        {selection === null ? (
          <Text style={styles.sheetEmpty}>No model is available for this fork.</Text>
        ) : (
          <ForkChoices
            actions={{
              chooseAgent,
              chooseEffort,
              chooseModel,
              fork,
              toggleFast,
              toggleModels,
            }}
            modelsExpanded={modelsExpanded}
            offer={offer}
            selection={selection}
          />
        )}
      </View>
    </AppSheet>
  );
}

/** The sheet's intents, each stable for the sheet's lifetime. */
type ForkChoiceActions = {
  readonly chooseAgent: (agent: ForkAgent) => void;
  readonly chooseEffort: (effort: string) => void;
  readonly chooseModel: (model: ForkModel) => void;
  readonly fork: () => void;
  readonly toggleFast: () => void;
  readonly toggleModels: () => void;
};

/** Who continues, the model, its thinking level and the primary action. */
function ForkChoices({
  actions,
  modelsExpanded,
  offer,
  selection,
}: {
  readonly actions: ForkChoiceActions;
  readonly modelsExpanded: boolean;
  readonly offer: ForkOffer;
  readonly selection: ForkSelection;
}): ReactElement {
  return (
    <>
      <ForkSection label="Who continues">
        <ForkAgentCards offer={offer} onChoose={actions.chooseAgent} selection={selection} />
        <ForkHandoffNote offer={offer} selection={selection} />
      </ForkSection>
      <ForkSection label="Model">
        <ForkModelPicker
          expanded={modelsExpanded}
          offer={offer}
          onChoose={actions.chooseModel}
          onToggle={actions.toggleModels}
          onToggleFast={actions.toggleFast}
          selection={selection}
        />
      </ForkSection>
      <ForkThinking onSelect={actions.chooseEffort} selection={selection} />
      <ForkAction onPress={actions.fork} selection={selection} />
    </>
  );
}

function ForkHeader({ boundary }: { readonly boundary: ThreadForkBoundary }): ReactElement {
  return (
    <View style={styles.forkHeader}>
      <Text style={styles.sheetTitle}>Fork chat</Text>
      <View style={styles.forkContext}>
        <Ionicons color={colors.textMuted} name="git-branch-outline" size={iconSize.inline} />
        <Text style={styles.forkContextText} testID="fork-boundary">
          {boundaryLabel(boundary)}
        </Text>
      </View>
    </View>
  );
}

function boundaryLabel(boundary: ThreadForkBoundary): string {
  if (boundary.kind === "all") {
    return "The whole chat";
  }
  return boundary.kind === "through" ? "Up to this message" : "Before this message";
}

function ForkSection({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}): ReactElement {
  return (
    <View style={styles.forkSection}>
      <Text style={styles.forkSectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function ForkAgentCards({
  offer,
  onChoose,
  selection,
}: {
  readonly offer: ForkOffer;
  readonly onChoose: (agent: ForkAgent) => void;
  readonly selection: ForkSelection;
}): ReactElement {
  return (
    <View accessibilityRole="radiogroup" style={styles.forkAgentCards}>
      {forkAgents(offer).map((agent) => (
        <ForkAgentCard
          agent={agent}
          key={agent.provider}
          onChoose={onChoose}
          selected={agent.provider === selection.provider}
        />
      ))}
    </View>
  );
}

function ForkAgentCard({
  agent,
  onChoose,
  selected,
}: {
  readonly agent: ForkAgent;
  readonly onChoose: (agent: ForkAgent) => void;
  readonly selected: boolean;
}): ReactElement {
  const choose = useEvent(() => {
    onChoose(agent);
  });
  const name = providerDisplayName(agent.provider);
  const copy = agentCopy(agent, name);
  return (
    <Pressable
      accessibilityLabel={`${name}, ${copy.outcome}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !agent.available }}
      disabled={!agent.available}
      onPress={choose}
      style={[
        styles.forkAgentCard,
        selected && styles.forkAgentCardSelected,
        !agent.available && styles.forkAgentCardDisabled,
      ]}
      testID={`fork-agent-${agent.provider}`}
    >
      <View style={styles.forkAgentHead}>
        <ProviderIcon color={colors.text} provider={agent.provider} size={iconSize.action} />
        <Text numberOfLines={1} style={styles.forkAgentName}>
          {name}
        </Text>
        <Text style={styles.forkAgentTag}>{agent.handoff ? "New agent" : "This agent"}</Text>
      </View>
      <Text style={styles.forkAgentOutcome}>{copy.outcome}</Text>
      <Text style={styles.forkAgentDetail}>{copy.detail}</Text>
      {selected && (
        <View style={styles.forkAgentCheck}>
          <Ionicons color={colors.onPrimary} name="checkmark" size={iconSize.indicator} />
        </View>
      )}
    </Pressable>
  );
}

function agentCopy(
  agent: ForkAgent,
  name: string,
): { readonly detail: string; readonly outcome: string } {
  if (!agent.available) {
    return {
      detail: `${name} can't fork its own chats.`,
      outcome: "Can't fork this chat",
    };
  }
  return agent.handoff
    ? {
        detail: "Reads a summary of this chat, not the whole transcript.",
        outcome: "Starts from a summary",
      }
    : { detail: "Continues exactly where this chat is.", outcome: "Keeps the full history" };
}

function ForkHandoffNote({
  offer,
  selection,
}: {
  readonly offer: ForkOffer;
  readonly selection: ForkSelection;
}): ReactElement | null {
  if (!selection.handoff || selection.provider === null || offer.provider === null) {
    return null;
  }
  return (
    <View style={styles.forkHandoffNote} testID="fork-handoff-note">
      <Ionicons color={colors.textMuted} name="information-circle-outline" size={iconSize.action} />
      <Text style={styles.forkHandoffText}>
        {`${providerDisplayName(selection.provider)} can't continue a ${providerDisplayName(offer.provider)} chat as is. The new chat starts from a summary of this conversation; this chat stays as it is.`}
      </Text>
    </View>
  );
}

/** The fork's model: the chosen agent's models, with Fast beside them when the model offers it. */
function ForkModelPicker({
  expanded,
  offer,
  onChoose,
  onToggle,
  onToggleFast,
  selection,
}: {
  readonly expanded: boolean;
  readonly offer: ForkOffer;
  readonly onChoose: (model: ForkModel) => void;
  readonly onToggle: () => void;
  readonly onToggleFast: () => void;
  readonly selection: ForkSelection;
}): ReactElement {
  const models = forkAgentModels(offer, selection.provider);
  const switchable = models.some((model) => model.id !== selection.model);
  return (
    <View>
      <View style={styles.forkModelRow}>
        <ModelDisclosure
          expanded={switchable && expanded}
          label={selection.label ?? "Current model"}
          onPress={switchable ? onToggle : null}
          provider={selection.provider}
        />
        {fastServiceTier(selection.row?.serviceTiers) !== undefined && (
          <FastModeToggle enabled={forkFastEnabled(selection)} onToggle={onToggleFast} />
        )}
      </View>
      {switchable && expanded && (
        <ModelChoiceList
          grouped={false}
          models={models}
          onChoose={onChoose}
          selectedModel={selection.model}
        />
      )}
    </View>
  );
}

function ForkThinking({
  onSelect,
  selection,
}: {
  readonly onSelect: (effort: string) => void;
  readonly selection: ForkSelection;
}): ReactElement | null {
  const row = selection.row;
  if (row === null || row.defaultEffort === null) {
    return null;
  }
  const selected = clampModelEffort(row, selection.effort) ?? row.defaultEffort;
  return (
    <ForkSection label="Thinking">
      <ThinkingLevelSlider
        key={`${row.provider}:${row.id}`}
        levels={modelEffortLevels(row)}
        onSelect={onSelect}
        selected={selected}
        testID="fork-thinking-level"
      />
    </ForkSection>
  );
}

function ForkAction({
  onPress,
  selection,
}: {
  readonly onPress: () => void;
  readonly selection: ForkSelection;
}): ReactElement {
  const label =
    selection.handoff && selection.provider !== null
      ? `Fork into ${providerDisplayName(selection.provider)}`
      : "Fork chat";
  return (
    <View style={styles.forkAction}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.forkButton, pressed && styles.forkButtonPressed]}
      >
        <Ionicons color={colors.onPrimary} name="git-branch-outline" size={iconSize.action} />
        <Text style={styles.forkButtonText}>{label}</Text>
      </Pressable>
      <Text style={styles.forkCaption} testID="fork-summary">
        {forkSummary(selection)}
      </Text>
    </View>
  );
}

/** One line naming what the fork continues with. */
function forkSummary(selection: ForkSelection): string {
  const row = selection.row;
  const parts = [selection.label ?? "Current model"];
  const effort = row === null ? selection.effort : clampModelEffort(row, selection.effort);
  if (effort !== null) {
    parts.push(`${modelEffortLabel(effort)} thinking`);
  }
  if (forkFastEnabled(selection)) {
    parts.push("Fast");
  }
  parts.push(selection.handoff ? "from a summary" : "full history");
  return parts.join(" · ");
}
