import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";
import { useEvent } from "../../react/useEvent";
import { useConversationState } from "../../ui/use-conversation-scope";

type GoalMode =
  | { readonly kind: "idle" }
  | { readonly kind: "create" }
  | { readonly goal: ThreadGoal; readonly kind: "edit" };

type ComposerGoalModeBinding = {
  readonly captureGoalAttachment: () => () => void;
  readonly closeGoalAttachment: () => void;
  readonly editingGoal: ThreadGoal | null;
  readonly goalAttachmentVisible: boolean;
  readonly openGoalAttachment: () => void;
  readonly openGoalEdit: (goal: ThreadGoal) => void;
};

/** Owns goal drafting intent; settlement cannot close a replacement chat or edit. */
export function useComposerGoalMode(scope: string): ComposerGoalModeBinding {
  const [state$] = useConversationState(scope, () =>
    observable<{ mode: GoalMode }>({ mode: { kind: "idle" } }),
  );
  const mode$ = state$.mode;
  const mode = useSelector(() => mode$.get());
  const openGoalAttachment = useEvent(() => {
    if (mode$.peek().kind === "idle") {
      mode$.set({ kind: "create" });
    }
  });
  const openGoalEdit = useEvent((goal: ThreadGoal) => {
    if (mode$.peek().kind !== "edit") {
      mode$.set({ goal, kind: "edit" });
    }
  });
  const closeGoalAttachment = useEvent(() => {
    mode$.set({ kind: "idle" });
  });
  const captureGoalAttachment = useEvent(() => {
    const owner = mode$;
    const captured = owner.peek();
    return () => {
      if (owner.peek() === captured) {
        owner.set({ kind: "idle" });
      }
    };
  });
  return {
    captureGoalAttachment,
    closeGoalAttachment,
    editingGoal: mode.kind === "edit" ? mode.goal : null,
    goalAttachmentVisible: mode.kind !== "idle",
    openGoalAttachment,
    openGoalEdit,
  };
}
