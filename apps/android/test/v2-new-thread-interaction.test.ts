import { describe, expect, it } from "vitest";

import { newThreadInteractionState } from "../src/v2/features/threadList/newThreadInteractionState";

describe("V2 New Thread interaction state", () => {
  it("keeps cached project selection available while restart resources recover", () => {
    const liveWithCorrelationResourceRecovering = newThreadInteractionState({
      actionPending: false,
      connectionLive: true,
      locallyLocked: true,
      submitting: false,
    });

    expect(liveWithCorrelationResourceRecovering).toEqual({
      composerLocked: true,
      projectMutationsLocked: false,
      projectSelectionLocked: false,
    });

    const reconnecting = newThreadInteractionState({
      actionPending: false,
      connectionLive: false,
      locallyLocked: true,
      submitting: false,
    });

    expect(reconnecting.projectSelectionLocked).toBe(false);
    expect(reconnecting.projectMutationsLocked).toBe(true);
    expect(reconnecting.composerLocked).toBe(true);

    const settled = newThreadInteractionState({
      actionPending: false,
      connectionLive: true,
      locallyLocked: false,
      submitting: false,
    });

    expect(settled).toEqual({
      composerLocked: false,
      projectMutationsLocked: false,
      projectSelectionLocked: false,
    });
  });

  it("freezes target selection while a submission owns the draft", () => {
    expect(
      newThreadInteractionState({
        actionPending: false,
        connectionLive: true,
        locallyLocked: false,
        submitting: true,
      }),
    ).toEqual({
      composerLocked: true,
      projectMutationsLocked: true,
      projectSelectionLocked: true,
    });
  });
});
