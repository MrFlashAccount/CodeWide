import { describe, expect, it, jest } from "@jest/globals";
import type { V2CommandTerminalFrame } from "@codewide/sync-client/v2";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import { ChatComposer } from "../src/v2/features/composer/ChatComposer";
import { createTurnActions } from "../src/v2/features/turnActions/turnActions";
import type {
  TurnActionCommandPort,
  TurnActionPresentationPort,
} from "../src/v2/features/turnActions/turnActionTypes";

const owner = qualifiedThread(savedServerId("saved-server-a"), threadId("thread-a"));

describe("V2 primary composer interruption", () => {
  it("sends the exact authoritative active turn once and waits for projection state", async () => {
    const terminal = deferred<V2CommandTerminalFrame>();
    const execute = jest.fn<TurnActionCommandPort["execute"]>(() => terminal.promise);
    const actions = createTurnActions({
      commands: { execute },
      owner,
      presentation: presentation(),
    });
    const onInterrupt = jest.fn(async (turnIdValue: string) => {
      await actions.interruptTurn(turnIdValue);
    });
    const onSubmit = jest.fn(async () => true);

    render(
      <ChatComposer
        activeTurnId="turn-running"
        disabled={false}
        onInterrupt={onInterrupt}
        onSubmit={onSubmit}
      />,
    );

    const stop = screen.getByLabelText("Stop response");
    fireEvent.press(stop);
    fireEvent.press(stop);

    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(owner.savedServerId, {
      kind: "turn.interrupt",
      threadId: owner.threadId,
      turnId: "turn-running",
    });
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByLabelText("Stop response").props.accessibilityState).toEqual({
        busy: true,
        disabled: true,
      }),
    );
    expect(screen.getByLabelText("Stop")).toBeTruthy();

    await act(async () => {
      terminal.resolve(completedInterrupt("turn-running"));
      await terminal.promise;
    });

    // The command result does not optimistically clear the active turn.
    expect(screen.getByLabelText("Stop response")).toBeTruthy();
    expect(screen.queryByLabelText("Send message")).toBeNull();
  });

  it("shows the exact failure and retries the same turn through the typed command", async () => {
    const execute = jest
      .fn<TurnActionCommandPort["execute"]>()
      .mockResolvedValueOnce(failedInterrupt("Observer refused this stop"))
      .mockResolvedValueOnce(completedInterrupt("turn-running"));
    const actions = createTurnActions({
      commands: { execute },
      owner,
      presentation: presentation(),
    });

    render(
      <ChatComposer
        activeTurnId="turn-running"
        disabled={false}
        onInterrupt={async (turnIdValue) => {
          await actions.interruptTurn(turnIdValue);
        }}
        onSubmit={async () => true}
      />,
    );

    fireEvent.press(screen.getByLabelText("Stop response"));
    expect(await screen.findByText("Observer refused this stop")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Retry failed action"));
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute).toHaveBeenNthCalledWith(2, owner.savedServerId, {
      kind: "turn.interrupt",
      threadId: owner.threadId,
      turnId: "turn-running",
    });
  });

  it("preserves message submission while a draft has content", async () => {
    const onInterrupt = jest.fn(async () => undefined);
    const onSubmit = jest.fn(async () => true);
    render(
      <ChatComposer
        activeTurnId="turn-running"
        disabled={false}
        onInterrupt={onInterrupt}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.changeText(screen.getByLabelText("Message Codex"), "Queue this message");
    fireEvent.press(screen.getByLabelText("Send message"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Queue this message"));
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it("keeps stop available when only message submission is locally locked", async () => {
    const onInterrupt = jest.fn(async () => undefined);
    render(
      <ChatComposer
        activeTurnId="turn-running"
        disabled={false}
        locked
        onInterrupt={onInterrupt}
        onSubmit={async () => true}
        retryBlocked
      />,
    );

    expect(screen.getByLabelText("Stop response").props.accessibilityState.disabled).toBe(false);
    fireEvent.press(screen.getByLabelText("Stop response"));
    await waitFor(() => expect(onInterrupt).toHaveBeenCalledWith("turn-running"));
  });
});

function completedInterrupt(turnIdValue: string): V2CommandTerminalFrame {
  return {
    operationId: "operation-interrupt",
    result: {
      kind: "turn.interrupt",
      state: "interrupted",
      threadId: owner.threadId,
      turnId: turnIdValue,
    },
    type: "commandCompleted",
  };
}

function failedInterrupt(message: string): V2CommandTerminalFrame {
  return {
    error: { code: "sourceUnavailable", message, recovery: "retry" },
    operationId: "operation-interrupt",
    type: "commandFailed",
  };
}

function presentation(): TurnActionPresentationPort {
  return {
    openPriorTurnEditor: () => undefined,
    openResponseReview: () => undefined,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
