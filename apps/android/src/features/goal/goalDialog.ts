import { useEvent } from "../../react/useEvent";
/** V1 GoalFeature owner, extracted without changing interaction or resource lifetime. */
import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";
import { useId, useRef, useState } from "react";
import { useAppVoiceInputRuntime, useVoiceInputResource } from "../../ui/VoiceInputRuntime";
import { validateGoalEditorDraft } from "./goalEditor";

import type { GoalDialogProps } from "./goalDialogContract";

export function useGoalDialog({
  goal,
  onClear,
  onClose,
  onSet,
  onSetStatus,
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
  const [pending, setPending] = useState<"clear" | "pause" | "resume" | "save" | null>(null);
  const operationPending = useRef(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const voicePhase = voiceResource?.phase ?? "idle";
  const busy = pending !== null;
  const effectiveError = error ?? voiceResource?.error ?? resourceError;
  const applyGoal = (next: ThreadGoal | null) => {
    setObjective(next?.objective ?? "");
    setTokenBudget(
      next?.tokenBudget === null || next?.tokenBudget === undefined ? "" : String(next.tokenBudget),
    );
  };
  const close = useEvent(() => {
    if (operationPending.current) {
      return;
    }
    if (voicePhase === "idle" || voiceController === null) {
      onClose();
      return;
    }
    voiceController.finish(voiceScope, false).then(onClose, (error: unknown) => {
      setError(error instanceof Error ? error.message : "Could not stop voice input");
    });
  });
  const save = useEvent(() => {
    if (operationPending.current) {
      return;
    }
    const validation = validateGoalEditorDraft(objective, tokenBudget, goal?.status ?? "active");
    if (validation.error !== null) {
      setError(validation.error);
      return;
    }
    operationPending.current = true;
    setPending("save");
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
        operationPending.current = false;
        setPending(null);
      })
      .catch((error: unknown) => {
        setError(error instanceof Error ? error.message : "Could not save goal");
        operationPending.current = false;
        setPending(null);
      });
  });
  const clear = useEvent(() => {
    if (operationPending.current) {
      return;
    }
    operationPending.current = true;
    setPending("clear");
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
        operationPending.current = false;
        setPending(null);
      })
      .catch((error: unknown) => {
        setError(error instanceof Error ? error.message : "Could not clear goal");
        operationPending.current = false;
        setPending(null);
      });
  });
  const setStatus = useEvent((status: "active" | "paused") => {
    if (operationPending.current) {
      return;
    }
    operationPending.current = true;
    setPending(status === "active" ? "resume" : "pause");
    setError(null);
    const operation = onSetStatus(status);
    operation
      .then(
        (next) => {
          applyGoal(next);
          onClose();
        },
        (error: unknown) => {
          setError(error instanceof Error ? error.message : "Could not update goal status");
        },
      )
      .then(() => {
        operationPending.current = false;
        setPending(null);
      })
      .catch((error: unknown) => {
        setError(error instanceof Error ? error.message : "Could not update goal status");
        operationPending.current = false;
        setPending(null);
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
  };
}
