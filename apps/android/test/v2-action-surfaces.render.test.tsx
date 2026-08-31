import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import type { V2Runtime } from "../src/v2/application/v2Runtime";
import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import { CommandCorrelationResource } from "../src/v2/application/resources/commandCorrelationResource";
import { ObservableResource } from "../src/v2/application/resources/resource";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { ChatComposer } from "../src/v2/features/composer/ChatComposer";
import { ConversationScreen } from "../src/v2/features/conversation/ConversationScreen";
import { NewThreadForm } from "../src/v2/features/threadList/NewThreadForm";
import { ActionPressable } from "../src/v2/ui/actions/ActionPressable";
import { ActionRunner } from "../src/v2/ui/actions/ActionRunner";

const serverId = savedServerId("saved-server-a");
const conversationThreadId = threadId("thread-a");

describe("V2 rendered action surfaces", () => {
  it("locks New Thread before allocation and permits retry only after proven non-creation", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const executeCorrelated = jest
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    renderNewThread(runtimeWith({ executeCorrelated }));

    fillNewThread();
    fireEvent.press(screen.getByLabelText("Create thread"));

    expect(screen.getByLabelText("Workspace path").props.editable).toBe(false);
    expect(screen.getByLabelText("First message").props.editable).toBe(false);
    expect(screen.getByLabelText("Create thread").props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });

    await act(async () => {
      first.resolve({
        correlationId: "correlation-a",
        failure: { message: "Nothing was saved. Try again." },
        kind: "notCreated",
        operationId: "operation-a",
      });
      await first.promise;
      await flushAsyncWork();
    });

    expect(screen.getByLabelText("Workspace path").props.editable).toBe(true);
    expect(screen.getByLabelText("Create thread").props.accessibilityState).toEqual({
      busy: false,
      disabled: false,
    });
    expect(screen.getByText("Nothing was saved. Try again.").props.accessibilityLiveRegion).toBe(
      "polite",
    );

    fireEvent.press(screen.getByLabelText("Create thread"));
    expect(executeCorrelated).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve({
        correlationId: "correlation-b",
        failure: { message: "Nothing was saved. Try again." },
        kind: "notCreated",
        operationId: "operation-b",
      });
      await second.promise;
      await flushAsyncWork();
    });
  });

  it("keeps a durable New Thread activation locked until matching completion", async () => {
    const controller = correlationController();
    const settlement = durableSettlement();
    const onThreadCreated = jest.fn();
    renderNewThread(
      runtimeWith({
        correlationResource: controller.resource,
        executeCorrelated: async () => settlement,
      }),
      onThreadCreated,
    );

    fillNewThread();
    fireEvent.press(screen.getByLabelText("Create thread"));
    await screen.findByText("Saved. Waiting for the server.");

    expect(controller.resource.isLocked(settlement.correlationId, settlement.operationId)).toBe(
      true,
    );
    expect(screen.getByLabelText("Workspace path").props.editable).toBe(false);
    expect(screen.getByLabelText("Create thread").props.accessibilityState.disabled).toBe(true);

    controller.setSettlement(completedSettlement());
    await act(async () => controller.resource.refresh());

    expect(onThreadCreated).toHaveBeenCalledWith("thread-a");
    expect(controller.resource.isLocked(settlement.correlationId, settlement.operationId)).toBe(
      false,
    );
  });

  it.each(["commandFailed", "commandIndeterminate", "commandExpired"] as const)(
    "blocks duplicate New Thread activation after authoritative %s until the draft changes",
    async (type) => {
      const executeCorrelated = jest.fn(async () => terminalSettlement(type));
      renderNewThread(runtimeWith({ executeCorrelated }));

      fillNewThread();
      fireEvent.press(screen.getByLabelText("Create thread"));
      await screen.findByText(/Change the draft before trying again\./);

      expect(executeCorrelated).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Create thread").props.accessibilityState.disabled).toBe(true);
      fireEvent.press(screen.getByLabelText("Create thread"));
      expect(executeCorrelated).toHaveBeenCalledTimes(1);

      fireEvent.changeText(screen.getByLabelText("First message"), "Create a changed feature");
      expect(screen.getByLabelText("Create thread").props.accessibilityState.disabled).toBe(false);
    },
  );

  it("settles a rendered Conversation durable message by exact operation id", async () => {
    const controller = correlationController("threadComposer");
    const executeCorrelated = jest.fn(async () => durableSettlement());
    renderConversation(
      runtimeWith({
        correlationResource: controller.resource,
        executeCorrelated,
        projection: conversationProjection(),
      }),
    );

    fireEvent.changeText(screen.getByLabelText("V2 message composer"), "keep this message");
    fireEvent.press(screen.getByLabelText("Send V2 message"));
    await screen.findByText("Saved. Waiting for the server.");
    expect(screen.getByLabelText("V2 message composer").props.editable).toBe(false);

    controller.setSettlement(completedSettlement());
    await act(async () => controller.resource.refresh());

    expect(screen.getByLabelText("V2 message composer").props.value).toBe("");
    expect(executeCorrelated).toHaveBeenCalledTimes(1);
  });

  it("keeps Conversation text and blocks duplicate send after indeterminate settlement", async () => {
    const controller = correlationController("threadComposer");
    const executeCorrelated = jest.fn(async () => durableSettlement());
    renderConversation(
      runtimeWith({
        correlationResource: controller.resource,
        executeCorrelated,
        projection: conversationProjection(),
      }),
    );

    const composer = screen.getByLabelText("V2 message composer");
    fireEvent.changeText(composer, "uncertain message");
    fireEvent.press(screen.getByLabelText("Send V2 message"));
    await screen.findByText("Saved. Waiting for the server.");

    controller.setSettlement(terminalSettlement("commandIndeterminate"));
    await act(async () => controller.resource.refresh());
    await screen.findByText(
      "The saved message outcome is unknown. Edit the draft before sending again.",
    );

    expect(composer.props.value).toBe("uncertain message");
    expect(composer.props.editable).toBe(true);
    expect(screen.getByLabelText("Send V2 message").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText("Send V2 message"));
    expect(executeCorrelated).toHaveBeenCalledTimes(1);

    fireEvent.changeText(composer, "changed message");
    expect(screen.getByLabelText("Send V2 message").props.accessibilityState.disabled).toBe(false);
  });

  it("restores process-death status without attaching it to a fresh Conversation draft", async () => {
    const controller = correlationController("threadComposer", true);
    renderConversation(
      runtimeWith({
        correlationResource: controller.resource,
        executeCorrelated: jest.fn(async () => durableSettlement()),
        projection: conversationProjection(),
      }),
    );

    await screen.findByText("1 saved message is waiting for the server");
    expect(screen.getByLabelText("V2 message composer").props.editable).toBe(true);

    controller.setSettlement(completedSettlement());
    await act(async () => controller.resource.refresh());

    expect(screen.queryByText("1 saved message is waiting for the server")).toBeNull();
    expect(screen.getByLabelText("V2 message composer").props.editable).toBe(true);
  });

  it("retains Composer input while pending and rejected, then clears it on terminal success", async () => {
    const first = deferred<boolean>();
    const onSubmit = jest
      .fn<(text: string) => Promise<boolean>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(true);
    const view = render(<ChatComposer disabled={false} error={null} onSubmit={onSubmit} />);
    const input = screen.getByLabelText("V2 message composer");

    fireEvent.changeText(input, "keep this draft");
    fireEvent.press(screen.getByLabelText("Send V2 message"));

    expect(input.props.editable).toBe(false);
    expect(input.props.value).toBe("keep this draft");
    expect(screen.getByLabelText("Send V2 message").props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });

    await act(async () => {
      first.resolve(false);
      await first.promise;
    });
    view.rerender(
      <ChatComposer disabled={false} error="Action failed. Try again." onSubmit={onSubmit} />,
    );

    expect(screen.getByLabelText("V2 message composer").props.value).toBe("keep this draft");
    expect(screen.getByText("Action failed. Try again.").props.accessibilityLiveRegion).toBe(
      "polite",
    );
    fireEvent.press(screen.getByLabelText("Send V2 message"));
    await act(async () => undefined);

    expect(screen.getByLabelText("V2 message composer").props.value).toBe("");
    expect(screen.getByLabelText("Send V2 message").props.accessibilityState).toEqual({
      busy: false,
      disabled: false,
    });
  });

  it("bounds an action rejection, unlocks the control, and announces the error", async () => {
    render(
      <ActionRunner>
        <ActionPressable
          action={{
            id: "rejecting-action",
            label: "Reject action",
            run: async () => {
              throw new Error("private detail");
            },
          }}
        />
      </ActionRunner>,
    );

    fireEvent.press(screen.getByLabelText("Reject action"));
    await screen.findByText("Action failed. Try again.");

    expect(screen.getByLabelText("Reject action").props.accessibilityState).toEqual({
      busy: false,
      disabled: false,
    });
    expect(screen.getByText("Action failed. Try again.").props.accessibilityLiveRegion).toBe(
      "polite",
    );
  });
});

function renderNewThread(runtime: V2Runtime, onThreadCreated = () => undefined): void {
  render(
    <V2RuntimeProvider runtime={runtime}>
      <ActionRunner>
        <NewThreadForm onThreadCreated={onThreadCreated} savedServerId={serverId} />
      </ActionRunner>
    </V2RuntimeProvider>,
  );
}

function renderConversation(runtime: V2Runtime): void {
  render(
    <V2RuntimeProvider runtime={runtime}>
      <ActionRunner>
        <ConversationScreen
          onOpenResource={() => undefined}
          owner={{ savedServerId: serverId, threadId: conversationThreadId }}
        />
      </ActionRunner>
    </V2RuntimeProvider>,
  );
}

function fillNewThread(): void {
  fireEvent.changeText(screen.getByLabelText("Workspace path"), "/workspace/project");
  fireEvent.changeText(screen.getByLabelText("First message"), "Create the feature");
}

function correlationResource(listUnsettled: () => Promise<never[]>): CommandCorrelationResource {
  return new CommandCorrelationResource(
    {
      listLocalUnsettled: listUnsettled,
      listUnsettled,
      reconcile: async () => null,
      subscribe: async () => () => undefined,
    } as never,
    { savedServerId: serverId, surface: "newThread", threadId: null },
  );
}

function runtimeWith(input: {
  correlationResource?: CommandCorrelationResource;
  executeCorrelated: (...args: never[]) => Promise<unknown>;
  projection?: ObservableResource<unknown>;
}): V2Runtime {
  const resource = input.correlationResource ?? correlationResource(async () => []);
  return {
    commandCorrelations: (_scope: unknown, onSettlement?: (settlement: never) => void) => {
      if (onSettlement !== undefined) resource.attachSettlementObserver(onSettlement);
      return resource;
    },
    commands: { executeCorrelated: input.executeCorrelated },
    projection: () => input.projection,
  } as unknown as V2Runtime;
}

function correlationController(
  surface: "newThread" | "threadComposer" = "newThread",
  recovered = false,
) {
  let settlement:
    | ReturnType<typeof durableSettlement>
    | ReturnType<typeof completedSettlement>
    | ReturnType<typeof terminalSettlement> = durableSettlement();
  const resource = new CommandCorrelationResource(
    {
      listLocalUnsettled: async () => (recovered ? [correlationRecord(surface)] : []),
      listUnsettled: async () => (recovered ? [correlationRecord(surface)] : []),
      reconcile: async () => settlement,
      subscribe: async () => () => undefined,
    } as never,
    {
      savedServerId: serverId,
      surface,
      threadId: surface === "threadComposer" ? conversationThreadId : null,
    },
  );
  return {
    resource,
    setSettlement(next: typeof settlement): void {
      settlement = next;
    },
  };
}

function correlationRecord(surface: "newThread" | "threadComposer") {
  return {
    correlationId: "correlation-a",
    createdAtMs: 1,
    operationId: "operation-a",
    savedServerId: serverId,
    state: "durable" as const,
    surface,
    threadId: surface === "threadComposer" ? conversationThreadId : null,
    updatedAtMs: 2,
  };
}

function durableSettlement() {
  return {
    correlationId: "correlation-a",
    failure: {
      code: "durableUnsettled" as const,
      message: "Saved. Waiting for the server.",
      retryable: false as const,
    },
    kind: "durableUnsettled" as const,
    operationId: "operation-a",
  };
}

function completedSettlement() {
  return {
    correlationId: "correlation-a",
    frame: {
      operationId: "operation-a",
      result: { kind: "turn.submit" as const, threadId: "thread-a", turnId: "turn-a" },
      type: "commandCompleted" as const,
    },
    kind: "terminal" as const,
    operationId: "operation-a",
  };
}

function terminalSettlement(type: "commandFailed" | "commandIndeterminate" | "commandExpired") {
  return {
    correlationId: "correlation-a",
    frame: {
      error: {
        code: type === "commandExpired" ? "operationExpired" : "operationIndeterminate",
        message: "Bounded terminal failure",
        recovery: type === "commandExpired" ? "userAction" : "requery",
      },
      operationId: "operation-a",
      ...(type === "commandExpired" ? { requestId: "correlation-a" } : {}),
      type,
    },
    kind: "terminal" as const,
    operationId: "operation-a",
  } as const;
}

function conversationProjection(): ObservableResource<unknown> {
  const inner = new ObservableResource({
    operations: [],
    projections: {
      live: {
        currentThread: {
          newerCursor: null,
          olderCursor: null,
          thread: { id: "thread-a", title: "Conversation" },
          turns: [],
        },
      },
      retained: null,
    },
    state: "live",
    version: 1,
  });
  inner.publish({ status: "ready", value: inner.snapshot().value });
  const outer = new ObservableResource<unknown>(null);
  outer.publish({ status: "ready", value: inner });
  return outer;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
