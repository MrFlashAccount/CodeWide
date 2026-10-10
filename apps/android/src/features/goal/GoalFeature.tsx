import { useGoalDialog } from "./goalDialog";
import type { GoalDialogProps } from "./goalDialogContract";
/** V1 GoalFeature owner, extracted without changing interaction or resource lifetime. */
import { AppButton as Button } from "../../presentation/controls/AppButton";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { AppModalDialog } from "../../presentation/overlay/AppModalDialog";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { styles } from "./GoalFeature.styles";
import { goalLifecycleAction, threadGoalStatusLabel } from "./goalStatus";

function ThreadGoalDialog({
  goal,
  onClear,
  onClose,
  onSet,
  onSetStatus,
  resourceError,
  visible,
  voiceScope: parentVoiceScope,
}: GoalDialogProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const {
    busy,
    clear,
    close,
    confirmClear,
    effectiveError,
    error,
    objective,
    pending,
    save,
    setConfirmClear,
    setError,
    setObjective,
    setStatus,
    setTokenBudget,
    tokenBudget,
    voicePhase,
    voiceScope,
  } = useGoalDialog({
    goal,
    onClear,
    onClose,
    onSet,
    onSetStatus,
    resourceError,
    visible,
    voiceScope: parentVoiceScope,
  });
  const changeObjective = useEvent((value: string) => {
    setObjective(value);
    if (error !== null) {
      setError(null);
    }
  });
  const toggleAdvanced = useEvent(() => {
    setAdvancedOpen((current) => !current);
  });
  const changeTokenBudget = useEvent((value: string) => {
    setTokenBudget(value);
    if (error !== null) {
      setError(null);
    }
  });
  const requestClear = useEvent(() => {
    if (confirmClear) {
      clear();
    } else {
      setConfirmClear(true);
    }
  });
  const lifecycleAction = goal === null ? null : goalLifecycleAction(goal.status);
  const changeStatus = useEvent(() => {
    if (lifecycleAction !== null) {
      setStatus(lifecycleAction.status);
    }
  });
  return (
    <AppModalDialog
      contentStyle={styles.goalDialogContent}
      dismissOnBackdrop={!busy}
      onDismiss={close}
      open={visible}
    >
      <KeyboardAvoidingView behavior="padding">
        <ScrollView
          contentContainerStyle={styles.goalDialogForm}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.goalDialogIntro}>
            <Text style={styles.goalDialogTitle}>
              {goal === null ? "Create goal" : "Edit goal"}
            </Text>
            <Pressable
              accessibilityLabel="Close goal dialog"
              accessibilityRole="button"
              disabled={busy}
              onPress={close}
              style={styles.goalDialogClose}
            >
              <Ionicons color={colors.textMuted} name="close" size={iconSize.action} />
            </Pressable>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>What should the agent work toward?</Text>
            <TextInput
              accessibilityLabel="Goal objective"
              autoFocus
              multiline
              onChangeText={changeObjective}
              placeholder="Describe the outcome…"
              placeholderTextColor={colors.textDim}
              style={styles.goalObjectiveInput}
              value={objective}
              voiceScope={voiceScope}
            />
            {effectiveError !== null && (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {effectiveError}
              </Text>
            )}
          </View>

          {goal !== null && (
            <View style={styles.goalStatusRow}>
              <Text style={styles.fieldLabel}>Status</Text>
              <Text style={styles.goalStatusValue}>{threadGoalStatusLabel(goal.status)}</Text>
            </View>
          )}

          <Pressable
            accessibilityLabel="Advanced goal options"
            accessibilityRole="button"
            accessibilityState={{ expanded: advancedOpen }}
            onPress={toggleAdvanced}
            style={styles.advancedToggle}
          >
            <Text style={styles.fieldLabel}>Advanced</Text>
            <Ionicons
              color={colors.textMuted}
              name={advancedOpen ? "chevron-up" : "chevron-down"}
              size={iconSize.inline}
            />
          </Pressable>
          {advancedOpen && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Token budget</Text>
              <TextInput
                accessibilityLabel="Goal token budget"
                keyboardType="number-pad"
                maxLength={15}
                onChangeText={changeTokenBudget}
                placeholder="No limit"
                placeholderTextColor={colors.textDim}
                style={styles.fieldInput}
                value={tokenBudget}
                voiceInput={false}
              />
            </View>
          )}

          {goal !== null && confirmClear && (
            <Text style={styles.goalClearPrompt}>Remove this goal from the thread?</Text>
          )}
          <View style={styles.goalDialogActions}>
            {goal !== null && (
              <>
                {lifecycleAction !== null && (
                  <Button isDisabled={busy} onPress={changeStatus} size="sm" variant="secondary">
                    {pending === lifecycleAction.kind
                      ? lifecycleAction.pendingLabel
                      : lifecycleAction.label}
                  </Button>
                )}
                <Button isDisabled={busy} onPress={requestClear} size="sm" variant="danger-soft">
                  {pending === "clear" ? "Removing…" : confirmClear ? "Remove" : "Clear goal"}
                </Button>
              </>
            )}
            <View style={styles.flex} />
            <Button isDisabled={busy} onPress={close} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button
              isDisabled={busy || objective.trim() === "" || voicePhase !== "idle"}
              onPress={save}
              size="sm"
              variant="primary"
            >
              {pending === "save" ? "Saving…" : goal === null ? "Create" : "Save"}
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </AppModalDialog>
  );
}

import type { ThreadGoalRow } from "../../data/workspace-resource-database";
import { AppSheet } from "../../ui/AppSheet";
/** Composes thread-goal display, editing, and durable update actions. */
export function GoalFeature({
  goalResource,
  onClearGoal,
  onClose,
  onSetGoal,
  onSetGoalStatus,
  visible,
  voiceScope,
}: {
  goalResource: ThreadGoalRow | null;
  onClearGoal?: GoalDialogProps["onClear"];
  onClose: () => void;
  onSetGoal?: GoalDialogProps["onSet"];
  onSetGoalStatus?: GoalDialogProps["onSetStatus"];
  visible: boolean;
  voiceScope: string;
}) {
  const changeOpen = useEvent((open: boolean) => {
    if (!open) {
      onClose();
    }
  });
  if (!visible) {
    return null;
  }
  if (onSetGoal === undefined || onSetGoalStatus === undefined || onClearGoal === undefined) {
    return (
      <AppSheet
        contentProps={{
          dismissLabel: "Close turn controls",
          enableDynamicSizing: true,
          index: 0,
        }}
        isOpen={visible}
        onOpenChange={changeOpen}
      >
        <Text style={styles.errorText}>Goals are unavailable for this conversation</Text>
      </AppSheet>
    );
  }
  const currentGoal = goalResource?.goal ?? null;
  return (
    <ThreadGoalDialog
      goal={currentGoal}
      key={currentGoal?.updatedAt ?? "empty"}
      onClear={onClearGoal}
      onClose={onClose}
      onSet={onSetGoal}
      onSetStatus={onSetGoalStatus}
      resourceError={goalResource?.error ?? null}
      visible
      voiceScope={voiceScope}
    />
  );
}
