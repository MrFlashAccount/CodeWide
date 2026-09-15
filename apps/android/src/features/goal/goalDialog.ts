import { useEvent } from "../../react/useEvent";
/** V1 GoalFeature owner, extracted without changing interaction or resource lifetime. */
import type { ThreadGoal } from "@codewide/codex-protocol/v0.147.0/v2";
import { useId, useState } from "react";
import { useAppVoiceInputRuntime, useVoiceInputResource } from "../../ui/VoiceInputRuntime";
import { validateGoalEditorDraft } from "./goalEditor";

import type { GoalDialogProps } from "./goalDialogContract";
export function useGoalDialog({
  onClose,
  goal,
  resourceError,
  onSet,
  onClear,
  voiceScope: parentVoiceScope,
}: GoalDialogProps) {
  const inputId = useId();
  const voiceScope = `${parentVoiceScope}\u0000goal\u0000${inputId}`;
  const voiceRuntime = useAppVoiceInputRuntime();
  const voiceController = voiceRuntime?.controller ?? null;
  const voiceResource = useVoiceInputResource(voiceRuntime, voiceScope);
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [tokenBudget, setTokenBudget] = useState(
    goal?.tokenBudget === null || goal?.tokenBudget === undefined ? "" : String(goal.tokenBudget),
  );
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voicePhase = voiceResource?.phase ?? "idle";
  const effectiveError = error ?? voiceResource?.error ?? resourceError;
  const applyGoal = (next: ThreadGoal | null) => {
    setObjective(next?.objective ?? "");
    setTokenBudget(
      next?.tokenBudget === null || next?.tokenBudget === undefined ? "" : String(next.tokenBudget),
    );
  };
  const close = useEvent(() => {
    if (voicePhase === "idle" || voiceController === null) {
      onClose();
      return;
    }
    void voiceController.finish(voiceScope, false).then(onClose);
  });
  const save = useEvent(() => {
    const validation = validateGoalEditorDraft(objective, tokenBudget, goal?.status ?? "active");
    if (validation.error !== null) {
      setError(validation.error);
      return;
    }
    setBusy(true);
    setError(null);
    const input = validation.value;
    const operation = onSet(input);
    void operation
      .then(
        (next) => {
          applyGoal(next);
          onClose();
        },
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not save goal");
        },
      )
      .then(() => setBusy(false));
  });
  const clear = useEvent(() => {
    setBusy(true);
    setError(null);
    const operation = onClear();
    void operation
      .then(
        (cleared) => {
          if (cleared) {
            applyGoal(null);
            setConfirmClear(false);
            onClose();
          } else setError("Goal was already cleared");
        },
        (cause: unknown) => {
          setError(cause instanceof Error ? cause.message : "Could not clear goal");
        },
      )
      .then(() => setBusy(false));
  });

  return {
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
  };
}
