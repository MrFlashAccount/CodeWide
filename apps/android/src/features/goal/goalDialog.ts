import { useEvent } from "../../react/useEvent";
/** V1 GoalFeature owner, extracted without changing interaction or resource lifetime. */
import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";
import { useId, useState } from "react";
import { useAppVoiceInputRuntime, useVoiceInputResource } from "../../ui/VoiceInputRuntime";
import { validateGoalEditorDraft } from "./goalEditor";

import type { GoalDialogProps } from "./goalDialogContract";

export function useGoalDialog({
  goal,
  onClear,
  onClose,
  onSet,
  resourceError,
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
    voiceController.finish(voiceScope, false).then(onClose, (error: unknown) => {
      setError(error instanceof Error ? error.message : "Could not stop voice input");
    });
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
    operation
      .then(
        (next) => {
          applyGoal(next);
          onClose();
        },
        (error: unknown) => {
          setError(error instanceof Error ? error.message : "Could not save goal");
        },
      )
      .then(() => {
        setBusy(false);
      })
      .catch((error: unknown) => {
        setError(error instanceof Error ? error.message : "Could not save goal");
        setBusy(false);
      });
  });
  const clear = useEvent(() => {
    setBusy(true);
    setError(null);
    const operation = onClear();
    operation
      .then(
        (cleared) => {
          if (cleared) {
            applyGoal(null);
            setConfirmClear(false);
            onClose();
          } else {
            setError("Goal was already cleared");
          }
        },
        (error: unknown) => {
          setError(error instanceof Error ? error.message : "Could not clear goal");
        },
      )
      .then(() => {
        setBusy(false);
      })
      .catch((error: unknown) => {
        setError(error instanceof Error ? error.message : "Could not clear goal");
        setBusy(false);
      });
  });

  return {
    busy,
    clear,
    close,
    confirmClear,
    effectiveError,
    error,
    objective,
    save,
    setConfirmClear,
    setError,
    setObjective,
    setTokenBudget,
    tokenBudget,
    voicePhase,
    voiceScope,
  };
}
