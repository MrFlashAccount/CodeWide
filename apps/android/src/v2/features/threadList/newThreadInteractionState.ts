export interface NewThreadInteractionStateInput {
  actionPending: boolean;
  connectionLive: boolean;
  locallyLocked: boolean;
  submitting: boolean;
}

export interface NewThreadInteractionState {
  composerLocked: boolean;
  projectMutationsLocked: boolean;
  projectSelectionLocked: boolean;
}

/** Separates safe local draft choices from actions that require live authority. */
export function newThreadInteractionState(
  input: NewThreadInteractionStateInput,
): NewThreadInteractionState {
  const activationPending = input.actionPending || input.submitting;
  return {
    composerLocked: activationPending || input.locallyLocked || !input.connectionLive,
    projectMutationsLocked: activationPending || !input.connectionLive,
    projectSelectionLocked: activationPending,
  };
}
