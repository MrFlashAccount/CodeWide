import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { ThreadGoalRow } from "../../data/workspace-resource-database";
import { AppButton as Button } from "../../presentation/controls/AppButton";
import { useEvent } from "../../react/useEvent";
import { colors, controlSize, iconSize, radii, spacing, typeScale, typeWeight } from "../../theme";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { useGoalDialog } from "./goalDialog";
import type { GoalDialogProps } from "./goalDialogContract";

const OBJECTIVE_MAX_HEIGHT = 120;
const OBJECTIVE_MIN_HEIGHT = 52;

type ComposerGoalAttachmentProps = {
  readonly goalResource: ThreadGoalRow | null;
  readonly onClear: GoalDialogProps["onClear"];
  readonly onClose: () => void;
  readonly onSet: GoalDialogProps["onSet"];
  readonly voiceScope: string;
};

/** Edits the thread goal in the same composer context area as file attachments. */
export function ComposerGoalAttachment({
  goalResource,
  onClear,
  onClose,
  onSet,
  voiceScope: parentVoiceScope,
}: ComposerGoalAttachmentProps): React.JSX.Element {
  const goal = goalResource?.goal ?? null;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const {
    busy,
    clear,
    close,
    effectiveError,
    error,
    objective,
    save,
    setError,
    setObjective,
    setTokenBudget,
    tokenBudget,
    voicePhase,
    voiceScope,
  } = useGoalDialog({
    goal,
    onClear,
    onClose,
    onSet,
    resourceError: goalResource?.error ?? null,
    visible: true,
    voiceScope: parentVoiceScope,
  });
  const changeObjective = useEvent((value: string) => {
    setObjective(value);
    if (error !== null) {
      setError(null);
    }
  });
  const changeTokenBudget = useEvent((value: string) => {
    setTokenBudget(value);
    if (error !== null) {
      setError(null);
    }
  });
  const toggleAdvanced = useEvent(() => {
    setAdvancedOpen((current) => !current);
  });

  return (
    <View style={styles.card} testID="composer-goal-attachment">
      <GoalAttachmentHeader busy={busy} existing={goal !== null} onClose={close} />
      <GoalObjectiveInput
        objective={objective}
        onChange={changeObjective}
        voiceScope={voiceScope}
      />
      <GoalError message={effectiveError} />
      <GoalBudgetInput
        onChange={changeTokenBudget}
        tokenBudget={tokenBudget}
        visible={advancedOpen}
      />
      <GoalAttachmentActions
        advancedOpen={advancedOpen}
        busy={busy}
        existing={goal !== null}
        objective={objective}
        onClear={clear}
        onSave={save}
        onToggleAdvanced={toggleAdvanced}
        voicePhase={voicePhase}
      />
    </View>
  );
}

function GoalAttachmentHeader({
  busy,
  existing,
  onClose,
}: {
  readonly busy: boolean;
  readonly existing: boolean;
  readonly onClose: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.header}>
      <Ionicons color={colors.textMuted} name="flag-outline" size={iconSize.action} />
      <Text style={styles.title}>{existing ? "Goal" : "New goal"}</Text>
      <Pressable
        accessibilityLabel="Close goal attachment"
        accessibilityRole="button"
        disabled={busy}
        onPress={onClose}
        style={styles.close}
      >
        <Ionicons color={colors.textMuted} name="close" size={iconSize.action} />
      </Pressable>
    </View>
  );
}

function GoalObjectiveInput({
  objective,
  onChange,
  voiceScope,
}: {
  readonly objective: string;
  readonly onChange: (value: string) => void;
  readonly voiceScope: string;
}): React.JSX.Element {
  return (
    <TextInput
      accessibilityLabel="Goal objective"
      multiline
      onChangeText={onChange}
      placeholder="What should Codex work toward?"
      placeholderTextColor={colors.textDim}
      style={styles.objective}
      value={objective}
      voiceScope={voiceScope}
    />
  );
}

function GoalError({ message }: { readonly message: string | null }): React.JSX.Element | null {
  if (message === null) {
    return null;
  }
  return (
    <Text accessibilityRole="alert" style={styles.error}>
      {message}
    </Text>
  );
}

function GoalBudgetInput({
  onChange,
  tokenBudget,
  visible,
}: {
  readonly onChange: (value: string) => void;
  readonly tokenBudget: string;
  readonly visible: boolean;
}): React.JSX.Element | null {
  if (!visible) {
    return null;
  }
  return (
    <TextInput
      accessibilityLabel="Goal token budget"
      keyboardType="number-pad"
      maxLength={15}
      onChangeText={onChange}
      placeholder="Token budget · no limit"
      placeholderTextColor={colors.textDim}
      style={styles.budget}
      value={tokenBudget}
      voiceInput={false}
    />
  );
}

function GoalAttachmentActions({
  advancedOpen,
  busy,
  existing,
  objective,
  onClear,
  onSave,
  onToggleAdvanced,
  voicePhase,
}: {
  readonly advancedOpen: boolean;
  readonly busy: boolean;
  readonly existing: boolean;
  readonly objective: string;
  readonly onClear: () => void;
  readonly onSave: () => void;
  readonly onToggleAdvanced: () => void;
  readonly voicePhase: ReturnType<typeof useGoalDialog>["voicePhase"];
}): React.JSX.Element {
  const saveDisabled = busy || objective.trim() === "" || voicePhase !== "idle";
  const saveLabel = goalSaveLabel(busy, existing);
  return (
    <View style={styles.actions}>
      <Button onPress={onToggleAdvanced} size="sm" variant="ghost">
        {advancedOpen ? "Hide budget" : "Token budget"}
      </Button>
      {existing ? (
        <Button isDisabled={busy} onPress={onClear} size="sm" variant="danger-soft">
          Remove
        </Button>
      ) : null}
      <View style={styles.spacer} />
      <Button isDisabled={saveDisabled} onPress={onSave} size="sm" variant="primary">
        {saveLabel}
      </Button>
    </View>
  );
}

function goalSaveLabel(busy: boolean, existing: boolean): string {
  if (busy) {
    return "Saving…";
  }
  return existing ? "Save" : "Create goal";
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  budget: {
    ...typeScale.body,
    backgroundColor: colors.surfaceContainerLow,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    color: colors.text,
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    gap: spacing.xs,
    marginHorizontal: spacing.sm,
    marginTop: spacing.xs,
    padding: spacing.sm,
  },
  close: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: controlSize.compact,
    minWidth: controlSize.compact,
  },
  error: {
    ...typeScale.label,
    color: colors.error,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  objective: {
    ...typeScale.body,
    color: colors.text,
    maxHeight: OBJECTIVE_MAX_HEIGHT,
    minHeight: OBJECTIVE_MIN_HEIGHT,
    paddingHorizontal: 0,
    paddingVertical: spacing.xs,
    textAlignVertical: "top",
  },
  spacer: { flex: 1 },
  title: {
    ...typeScale.label,
    color: colors.text,
    flex: 1,
    fontWeight: typeWeight.semibold,
  },
});
