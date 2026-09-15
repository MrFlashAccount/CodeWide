import { useGoalDialog } from "./goalDialog";
import type { GoalDialogProps } from "./goalDialogContract";
/** V1 GoalFeature owner, extracted without changing interaction or resource lifetime. */
import { Accordion } from "heroui-native/accordion";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { FieldError } from "heroui-native/field-error";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import { KeyboardAvoidingView, View } from "react-native";
import { colors } from "../../theme";
import { AppText as Text, AppTextInput as TextInput } from "../../ui/Typography";
import { styles } from "./GoalFeature.styles";

export function ThreadGoalDialog({
  visible,
  onClose,
  goal,
  resourceError,
  onSet,
  onClear,
  voiceScope: parentVoiceScope,
}: GoalDialogProps) {
  const {
    objective,
    setObjective,
    tokenBudget,
    setTokenBudget,
    busy,
    confirmClear,
    setConfirmClear,
    error,
    setError,
    voicePhase,
    voiceScope,
    effectiveError,
    close,
    save,
    clear,
  } = useGoalDialog({
    visible,
    onClose,
    goal,
    resourceError,
    onSet,
    onClear,
    voiceScope: parentVoiceScope,
  });
  return (
    <Dialog
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay isCloseOnPress={!busy} />
        <KeyboardAvoidingView behavior="padding">
          <Dialog.Content style={styles.goalDialogContent}>
            <Dialog.Close accessibilityLabel="Close goal dialog" isDisabled={busy} />

            <View style={styles.goalDialogIntro}>
              <Dialog.Title>{goal === null ? "Create goal" : "Edit goal"}</Dialog.Title>
            </View>

            <TextField isRequired isInvalid={effectiveError !== null}>
              <Label>What should Codex work toward?</Label>
              <TextInput
                voiceScope={voiceScope}
                autoFocus
                accessibilityLabel="Goal objective"
                multiline
                value={objective}
                onChangeText={(value) => {
                  setObjective(value);
                  if (error !== null) setError(null);
                }}
                placeholder="Describe the outcome…"
                placeholderTextColor={colors.textDim}
                style={styles.goalObjectiveInput}
              />
              {effectiveError !== null && <FieldError>{effectiveError}</FieldError>}
            </TextField>

            <Accordion selectionMode="single" variant="surface" hideSeparator>
              <Accordion.Item value="advanced">
                <Accordion.Trigger accessibilityLabel="Advanced goal options">
                  <Text>Advanced</Text>
                  <Accordion.Indicator />
                </Accordion.Trigger>
                <Accordion.Content>
                  <TextField>
                    <Label>Token budget</Label>
                    <TextInput
                      voiceInput={false}
                      accessibilityLabel="Goal token budget"
                      keyboardType="number-pad"
                      maxLength={15}
                      value={tokenBudget}
                      onChangeText={(value) => {
                        setTokenBudget(value);
                        if (error !== null) setError(null);
                      }}
                      placeholder="No limit"
                      placeholderTextColor={colors.textDim}
                      style={styles.fieldInput}
                    />
                  </TextField>
                </Accordion.Content>
              </Accordion.Item>
            </Accordion>

            {goal !== null && confirmClear && (
              <Text style={styles.goalClearPrompt}>Remove this goal from the thread?</Text>
            )}
            <View style={styles.goalDialogActions}>
              {goal !== null && (
                <Button
                  size="sm"
                  variant="danger-soft"
                  isDisabled={busy}
                  onPress={() => (confirmClear ? clear() : setConfirmClear(true))}
                >
                  {confirmClear ? "Remove" : "Clear goal"}
                </Button>
              )}
              <View style={styles.flex} />
              <Button size="sm" variant="ghost" isDisabled={busy} onPress={close}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                isDisabled={busy || objective.trim() === "" || voicePhase !== "idle"}
                onPress={save}
              >
                {busy ? "Saving…" : goal === null ? "Create" : "Save"}
              </Button>
            </View>
          </Dialog.Content>
        </KeyboardAvoidingView>
      </Dialog.Portal>
    </Dialog>
  );
}

import type { ThreadGoalRow } from "../../data/workspace-resource-database";
import { AppSheet } from "../../ui/AppSheet";
export function GoalFeature({
  visible,
  onClose,
  goalResource,
  voiceScope,
  onSetGoal,
  onClearGoal,
}: {
  visible: boolean;
  onClose(): void;
  goalResource: ThreadGoalRow | null;
  voiceScope: string;
  onSetGoal?: GoalDialogProps["onSet"];
  onClearGoal?: GoalDialogProps["onClear"];
}) {
  if (!visible) return null;
  if (onSetGoal === undefined || onClearGoal === undefined) {
    return (
      <AppSheet
        isOpen={visible}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        contentProps={{
          dismissLabel: "Close turn controls",
          index: 0,
          enableDynamicSizing: true,
        }}
      >
        <Text style={styles.errorText}>Goals are unavailable for this conversation</Text>
      </AppSheet>
    );
  }
  const currentGoal = goalResource?.goal ?? null;
  return (
    <ThreadGoalDialog
      key={currentGoal?.updatedAt ?? "empty"}
      visible
      onClose={onClose}
      goal={currentGoal}
      resourceError={goalResource?.error ?? null}
      voiceScope={voiceScope}
      onSet={onSetGoal}
      onClear={onClearGoal}
    />
  );
}

import { useEvent } from "../../react/useEvent";
export function useGoalDetails(openAccessory: (action: "goal") => void) {
  return useEvent(() => openAccessory("goal"));
}
