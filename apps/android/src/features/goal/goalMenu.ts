import { observable, type Observable } from "@legendapp/state";
import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";

import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import type { GoalLifecycleCommands } from "./goalLifecycleCommands";
import { captureGoalTurn, performGoalMenuAction, type GoalMenuAction } from "./goalMenuLifecycle";

/** Observable settlement state for one popover action. */
export type GoalMenuOperation =
  | { readonly status: "idle" }
  | { readonly action: GoalMenuAction; readonly status: "pending" }
  | { readonly error: string; readonly status: "error" };

type GoalMenuState = { objectiveHeight: number; open: boolean; operation: GoalMenuOperation };
type GoalMenuBinding = {
  readonly changeOpen: (open: boolean) => void;
  readonly edit: () => void;
  readonly measureObjective: (width: number, height: number) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly state$: Observable<GoalMenuState>;
  readonly stop: () => void;
  readonly toggleOpen: () => void;
};

/** Qualified interaction inputs; transport, goal state and editing remain with their owners. */
export type GoalMenuCapabilities = {
  readonly captureGoalLifecycle: (() => GoalLifecycleCommands) | undefined;
  readonly currentTurnId: string | null;
  readonly goal: ThreadGoal;
  readonly onBeforeOpen: () => void;
  readonly onEdit: () => void;
  readonly onInterrupt: ((turnId: string) => Promise<void>) | undefined;
};

/** Owns popover state and captures pause/stop ownership before the first await. */
export function useGoalMenu(props: GoalMenuCapabilities): GoalMenuBinding {
  const state$ = useConstant(() =>
    observable<GoalMenuState>({
      objectiveHeight: 0,
      open: false,
      operation: { status: "idle" },
    }),
  );
  const changeOpen = useEvent((open: boolean) => {
    if (open) {
      props.onBeforeOpen();
    }
    state$.open.set(open);
    if (!open) {
      state$.objectiveHeight.set(0);
    }
  });
  const toggleOpen = useEvent(() => {
    changeOpen(!state$.open.peek());
  });
  const measureObjective = useEvent((_width: number, height: number) => {
    if (Number.isFinite(height) && height > 0) {
      state$.objectiveHeight.set(height);
    }
  });
  const edit = useEvent(() => {
    if (state$.operation.peek().status === "pending") {
      return;
    }
    changeOpen(false);
    props.onEdit();
  });
  const run = useEvent((action: GoalMenuAction): void => {
    if (state$.operation.peek().status === "pending") {
      return;
    }
    const capture = props.captureGoalLifecycle;
    const turn = captureGoalTurn(props.currentTurnId, props.onInterrupt);
    const goalStatus = props.goal.status;
    if (capture === undefined || turn.status === "unavailable") {
      return;
    }
    state$.operation.set({ action, status: "pending" });
    void performGoalMenuAction({ action, capture, goalStatus, turn }).then(
      () => {
        state$.set({ objectiveHeight: 0, open: false, operation: { status: "idle" } });
      },
      (error: unknown) => {
        state$.operation.set({
          error: error instanceof Error ? error.message : "Could not update goal",
          status: "error",
        });
      },
    );
  });
  const pause = useEvent(() => {
    run("pause");
  });
  const resume = useEvent(() => {
    run("resume");
  });
  const stop = useEvent(() => {
    run("stop");
  });
  return { changeOpen, edit, measureObjective, pause, resume, state$, stop, toggleOpen };
}
