import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import type { V2Query, V2QueryResult, V2TurnView } from "@codewide/sync-client/v2";
import type { V2Runtime } from "../src/v2/application/v2Runtime";
import { ComposerAttachmentController } from "../src/v2/application/composer/composerAttachmentController";
import type { ComposerAttachmentTransport } from "../src/v2/application/ports/composerAttachmentTransport";
import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import { CommandCorrelationResource } from "../src/v2/application/resources/commandCorrelationResource";
import { ObservableResource } from "../src/v2/application/resources/resource";
import { ThreadPinsResource } from "../src/v2/application/resources/threadPinsResource";
import { VoiceInputController } from "../src/v2/application/voiceInputController";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { ChatComposer } from "../src/v2/features/composer/ChatComposer";
import { ConversationScreen } from "../src/v2/features/conversation/ConversationScreen";
import { NewThreadForm } from "../src/v2/features/threadList/NewThreadForm";
import { ActionPressable } from "../src/v2/ui/actions/ActionPressable";
import { ActionRunner } from "../src/v2/ui/actions/ActionRunner";

jest.mock("../src/v2/platform/drawing/quickdrawImageSource", () => ({
  quickdrawImageSource: { load: jest.fn() },
}));

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

    await waitForComposerUnlocked();
    fillNewThread();
    fireEvent.press(screen.getByLabelText("Send message"));

    expect(screen.getByLabelText("Message Codex").props.editable).toBe(false);
    expect(screen.getByLabelText("Send message").props.accessibilityState).toEqual({
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
    });

    await waitFor(() => expect(screen.getByLabelText("Message Codex").props.editable).toBe(true));
    expect(screen.getByLabelText("Send message").props.accessibilityState).toEqual({
      busy: false,
      disabled: false,
    });
    expect(screen.getByText("Nothing was saved. Try again.").props.accessibilityLiveRegion).toBe(
      "polite",
    );

    fireEvent.press(screen.getByLabelText("Send message"));
    await waitFor(() => expect(executeCorrelated).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve({
        correlationId: "correlation-b",
        failure: { message: "Nothing was saved. Try again." },
        kind: "notCreated",
        operationId: "operation-b",
      });
      await second.promise;
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

    await waitForComposerUnlocked();
    fillNewThread();
    fireEvent.press(screen.getByLabelText("Send message"));
    await screen.findByText("Saved. Waiting for the server.");

    expect(controller.resource.isLocked(settlement.correlationId, settlement.operationId)).toBe(
      true,
    );
    expect(screen.getByLabelText("Message Codex").props.editable).toBe(false);
    expect(screen.getByLabelText("Send message").props.accessibilityState.disabled).toBe(true);

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

      await waitForComposerUnlocked();
      fillNewThread();
      fireEvent.press(screen.getByLabelText("Send message"));
      await screen.findByText(/Change the draft before trying again\./);

      expect(executeCorrelated).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Send message").props.accessibilityState.disabled).toBe(true);
      fireEvent.press(screen.getByLabelText("Send message"));
      expect(executeCorrelated).toHaveBeenCalledTimes(1);

      fireEvent.changeText(screen.getByLabelText("Message Codex"), "Create a changed feature");
      expect(screen.getByLabelText("Send message").props.accessibilityState.disabled).toBe(false);
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

    await waitForComposerUnlocked();
    fireEvent.changeText(screen.getByLabelText("Message Codex"), "keep this message");
    fireEvent.press(screen.getByLabelText("Send message"));
    await screen.findByText("Saved. Waiting for the server.");
    expect(screen.getByLabelText("Message Codex").props.editable).toBe(false);

    controller.setSettlement(completedSettlement());
    await act(async () => controller.resource.refresh());

    expect(screen.getByLabelText("Message Codex").props.value).toBe("");
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

    await waitForComposerUnlocked();
    const composer = screen.getByLabelText("Message Codex");
    fireEvent.changeText(composer, "uncertain message");
    fireEvent.press(screen.getByLabelText("Send message"));
    await screen.findByText("Saved. Waiting for the server.");

    controller.setSettlement(terminalSettlement("commandIndeterminate"));
    await act(async () => controller.resource.refresh());
    await screen.findByText(
      "The saved message outcome is unknown. Edit the draft before sending again.",
    );

    expect(composer.props.value).toBe("uncertain message");
    expect(composer.props.editable).toBe(true);
    expect(screen.getByLabelText("Send message").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByLabelText("Send message"));
    expect(executeCorrelated).toHaveBeenCalledTimes(1);

    fireEvent.changeText(composer, "changed message");
    expect(screen.getByLabelText("Send message").props.accessibilityState.disabled).toBe(false);
  });

  it("locks a fresh Conversation draft after process death until explicit user release", async () => {
    const executeCorrelated = jest.fn(async () => durableSettlement());
    const controller = correlationController("threadComposer", true);
    renderConversation(
      runtimeWith({
        correlationResource: controller.resource,
        executeCorrelated,
        projection: conversationProjection(),
      }),
    );

    await screen.findByText("1 saved message is waiting for the server");
    expect(screen.getByLabelText("Message Codex").props.editable).toBe(false);
    expect(executeCorrelated).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText("Send another anyway"));
    await waitFor(() => expect(screen.getByLabelText("Message Codex").props.editable).toBe(true));
    fireEvent.changeText(screen.getByLabelText("Message Codex"), "fresh draft");

    controller.setSettlement(completedSettlement());
    await act(async () => controller.resource.refresh());

    expect(screen.queryByText("1 saved message is waiting for the server")).toBeNull();
    expect(screen.getByLabelText("Message Codex").props.editable).toBe(true);
    expect(screen.getByLabelText("Message Codex").props.value).toBe("fresh draft");
  });

  it("shows the authoritative V2 port count in the conversation context", async () => {
    renderConversation(
      runtimeWith({
        executeCorrelated: jest.fn(async () => durableSettlement()),
        ports: [{ details: "", forwardingKey: "port-a", group: "local", name: "Web", port: 3000 }],
        projection: conversationProjection(),
      }),
    );
    await act(async () => undefined);

    expect(screen.getByLabelText("Ports: 1")).toBeTruthy();
    expect(screen.queryByLabelText("Ports: 2")).toBeNull();
  });

  it("omits empty changes and attachments from the conversation context", async () => {
    renderConversation(
      runtimeWith({
        executeCorrelated: jest.fn(async () => durableSettlement()),
        projection: conversationProjection(),
      }),
    );
    await act(async () => undefined);

    expect(screen.queryByLabelText(/Changes/)).toBeNull();
    expect(screen.queryByLabelText(/Attachments/)).toBeNull();
  });

  it("sends one authoritative queue command while the thread is running", async () => {
    const executeCorrelated = jest.fn(async () => durableSettlement());
    renderConversation(
      runtimeWith({
        executeCorrelated,
        projection: conversationProjection([runningTurn()]),
      }),
    );

    await waitForComposerUnlocked();
    expect(screen.getByLabelText("Delivery mode: Queue")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Message Codex"), "Queue this message");
    fireEvent.press(screen.getByLabelText("Send message"));

    await waitFor(() =>
      expect(executeCorrelated).toHaveBeenCalledWith(
        {
          savedServerId: serverId,
          surface: "threadComposer",
          threadId: conversationThreadId,
        },
        {
          kind: "queue.mutate",
          mutation: {
            input: [{ kind: "text", text: "Queue this message" }],
            kind: "put",
            threadId: conversationThreadId,
          },
        },
      ),
    );
  });

  it("updates model and thinking through the V2 model chip", async () => {
    const execute = jest.fn(async () => completedThreadUpdate());
    renderConversation(
      runtimeWith({
        execute,
        executeCorrelated: jest.fn(async () => durableSettlement()),
        models: modelCatalog(),
        projection: conversationProjection(),
      }),
    );

    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6 Sol, high"));
    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6 Sol, high: GPT-5.6 Terra"));

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(serverId, {
        change: {
          kind: "settings",
          settings: {
            approvalPolicy: "never",
            effort: "high",
            model: "gpt-5.6-terra",
            personality: null,
            sandbox: "unrestricted",
          },
        },
        kind: "thread.update",
        threadId: conversationThreadId,
      }),
    );
  });

  it("updates the thinking level through the V2 conversation model chip", async () => {
    const execute = jest.fn(async () => completedThreadUpdate());
    renderConversation(
      runtimeWith({
        execute,
        executeCorrelated: jest.fn(async () => durableSettlement()),
        models: modelCatalog(),
        projection: conversationProjection(),
      }),
    );

    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6 Sol, high"));
    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6 Sol, high: Extra high"));

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(serverId, {
        change: {
          kind: "settings",
          settings: {
            approvalPolicy: "never",
            effort: "xhigh",
            model: "gpt-5.6-sol",
            personality: null,
            sandbox: "unrestricted",
          },
        },
        kind: "thread.update",
        threadId: conversationThreadId,
      }),
    );
  });

  it("updates personality through the existing-thread model chip", async () => {
    const execute = jest.fn(async () => completedThreadUpdate());
    renderConversation(
      runtimeWith({
        execute,
        executeCorrelated: jest.fn(async () => durableSettlement()),
        models: modelCatalog(),
        projection: conversationProjection(),
      }),
    );

    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6 Sol, high"));
    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6 Sol, high: Friendly"));

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(serverId, {
        change: {
          kind: "settings",
          settings: {
            approvalPolicy: "never",
            effort: "high",
            model: "gpt-5.6-sol",
            personality: "friendly",
            sandbox: "unrestricted",
          },
        },
        kind: "thread.update",
        threadId: conversationThreadId,
      }),
    );
  });

  it("renames a V2 thread through the authoritative thread.update command", async () => {
    const execute = jest.fn(async () => completedThreadUpdate());
    renderConversation(
      runtimeWith({
        execute,
        executeCorrelated: jest.fn(async () => durableSettlement()),
        projection: conversationProjection(),
      }),
    );

    const voiceActionCount = screen.getAllByLabelText("Voice input").length;
    fireEvent.press(screen.getByLabelText("Thread menu"));
    fireEvent.press(screen.getByLabelText("Thread menu: Rename"));
    expect(screen.getAllByLabelText("Voice input")).toHaveLength(voiceActionCount + 1);
    fireEvent.changeText(screen.getByLabelText("Thread name"), "Renamed conversation");
    fireEvent.press(screen.getByLabelText("Rename thread"));

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(serverId, {
        change: { kind: "title", title: "Renamed conversation" },
        kind: "thread.update",
        threadId: conversationThreadId,
      }),
    );
  });

  it("submits a new thread with selected model, personality, and permissions", async () => {
    const executeCorrelated = jest.fn(async () => completedSettlement());
    renderNewThread(runtimeWith({ executeCorrelated, models: modelCatalog() }));

    await waitForComposerUnlocked();
    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6 Sol, high"));
    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6 Sol, high: Extra high"));
    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6 Sol, xhigh: Friendly"));
    fireEvent.press(screen.getByLabelText("Permissions: Workspace · Ask"));
    fireEvent.press(screen.getByLabelText("Permissions: Workspace · Ask: Full access"));
    fireEvent.press(screen.getByLabelText("Permissions: Full access · Ask: Never ask"));
    fillNewThread();
    fireEvent.press(screen.getByLabelText("Send message"));

    await waitFor(() =>
      expect(executeCorrelated).toHaveBeenCalledWith(
        {
          savedServerId: serverId,
          surface: "newThread",
          threadId: null,
        },
        expect.objectContaining({
          kind: "turn.submit",
          settings: {
            approvalPolicy: "never",
            effort: "xhigh",
            model: "gpt-5.6-sol",
            personality: "friendly",
            sandbox: "unrestricted",
          },
        }),
      ),
    );
  });

  it("creates an isolated workspace before submitting a new thread", async () => {
    const execute = jest.fn(async () => completedWorkspaceCreate());
    const executeCorrelated = jest.fn(async () => completedSettlement());
    renderNewThread(
      runtimeWith({
        execute,
        executeCorrelated,
        workspaceSupport: {
          canCreate: true,
          provider: "git",
          repositoryRoot: "/workspace/project",
        },
      }),
    );

    await waitForComposerUnlocked();
    fireEvent.press(await screen.findByLabelText("Workspace mode, in this folder"));
    fireEvent.press(screen.getByLabelText("Choose workspace mode: New workspace"));
    fillNewThread();
    fireEvent.press(screen.getByLabelText("Send message"));

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(serverId, {
        kind: "workspace.create",
        name: "project",
        parentPath: "/workspace",
        provider: "git",
      }),
    );
    await waitFor(() =>
      expect(executeCorrelated).toHaveBeenCalledWith(
        {
          savedServerId: serverId,
          surface: "newThread",
          threadId: null,
        },
        expect.objectContaining({
          kind: "turn.submit",
          workspace: "/isolated/project",
        }),
      ),
    );
  });

  it("updates access through the V2 permissions chip", async () => {
    const execute = jest.fn(async () => completedThreadUpdate());
    renderConversation(
      runtimeWith({
        execute,
        executeCorrelated: jest.fn(async () => durableSettlement()),
        models: modelCatalog(),
        projection: conversationProjection(),
      }),
    );

    fireEvent.press(screen.getByLabelText("Permissions: Full access"));
    fireEvent.press(screen.getByLabelText("Permissions: Full access: Read only"));

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(serverId, {
        change: {
          kind: "settings",
          settings: {
            approvalPolicy: "never",
            effort: "high",
            model: "gpt-5.6-sol",
            personality: null,
            sandbox: "readOnly",
          },
        },
        kind: "thread.update",
        threadId: conversationThreadId,
      }),
    );
  });

  it("pins a conversation through the durable V2 thread pin resource", async () => {
    const pins = new ThreadPinsResource({
      deleteSavedServer: async () => undefined,
      list: async () => [],
      setPinned: async () => undefined,
    });
    await pins.start();
    renderConversation(
      runtimeWith({
        executeCorrelated: jest.fn(async () => durableSettlement()),
        projection: conversationProjection(),
        threadPins: pins,
      }),
    );

    fireEvent.press(screen.getByLabelText("Thread menu"));
    fireEvent.press(screen.getByLabelText("Thread menu: Pin thread"));

    await waitFor(() => expect(pins.isPinned(serverId, conversationThreadId)).toBe(true));
    expect(screen.getByText("Unpin thread")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Thread menu: Unpin thread"));

    await waitFor(() => expect(pins.isPinned(serverId, conversationThreadId)).toBe(false));
    expect(screen.getByText("Pin thread")).toBeTruthy();
  });

  it("retains Composer input while pending and rejected, then clears it on terminal success", async () => {
    const first = deferred<boolean>();
    const onSubmit = jest
      .fn<(text: string) => Promise<boolean>>()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(true);
    const view = render(<ChatComposer disabled={false} error={null} onSubmit={onSubmit} />);
    const input = screen.getByLabelText("Message Codex");

    fireEvent.changeText(input, "keep this draft");
    fireEvent.press(screen.getByLabelText("Send message"));

    expect(input.props.editable).toBe(false);
    expect(input.props.value).toBe("keep this draft");
    expect(screen.getByLabelText("Send message").props.accessibilityState).toEqual({
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

    expect(screen.getByLabelText("Message Codex").props.value).toBe("keep this draft");
    expect(screen.getByText("Action failed. Try again.").props.accessibilityLiveRegion).toBe(
      "polite",
    );
    fireEvent.press(screen.getByLabelText("Send message"));
    await act(async () => undefined);

    expect(screen.getByLabelText("Message Codex").props.value).toBe("");
    expect(screen.getByLabelText("Send message").props.accessibilityState.disabled).toBe(true);
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
        <NewThreadForm
          onBack={() => undefined}
          onThreadCreated={onThreadCreated}
          savedServerId={serverId}
        />
      </ActionRunner>
    </V2RuntimeProvider>,
  );
}

function renderConversation(runtime: V2Runtime): void {
  render(
    <V2RuntimeProvider runtime={runtime}>
      <ActionRunner>
        <ConversationScreen
          onBack={() => undefined}
          onOpenPorts={() => undefined}
          onOpenResource={() => undefined}
          owner={{ savedServerId: serverId, threadId: conversationThreadId }}
        />
      </ActionRunner>
    </V2RuntimeProvider>,
  );
}

function fillNewThread(): void {
  fireEvent.changeText(screen.getByLabelText("Message Codex"), "Create the feature");
}

async function waitForComposerUnlocked(): Promise<void> {
  await waitFor(() => expect(screen.getByLabelText("Message Codex").props.editable).toBe(true));
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
  execute?: (...args: never[]) => Promise<unknown>;
  executeCorrelated: (...args: never[]) => Promise<unknown>;
  models?: Extract<V2QueryResult, { kind: "models.list" }>["models"];
  ports?: Array<{
    details: string;
    forwardingKey: string;
    group: string;
    name: string;
    port: number;
  }>;
  projection?: ObservableResource<unknown>;
  threadPins?: ThreadPinsResource;
  workspaceSupport?: Extract<V2QueryResult, { kind: "workspace.inspect" }>["support"];
}): V2Runtime {
  const resource = input.correlationResource ?? correlationResource(async () => []);
  const projection = input.projection ?? conversationProjection();
  const savedServers = new ObservableResource([
    {
      displayName: "Server",
      emoji: "🖥️",
      enabled: true,
      endpoint: "wss://example.test/v2/sync",
      id: serverId,
    },
  ]);
  const attachmentTransport: ComposerAttachmentTransport = {
    createBytes: (name, mediaType, value) => ({
      handle: name,
      mediaType,
      name,
      sizeBytes: value.byteLength,
    }),
    createText: (name, mediaType, value) => ({
      handle: name,
      mediaType,
      name,
      sizeBytes: value.length,
    }),
    pick: async () => null,
    reference: (attachment) => ({
      mediaType: attachment.mediaType,
      name: attachment.name,
      sizeBytes: attachment.sizeBytes,
      token: attachment.handle,
    }),
    release: () => undefined,
    restore: () => null,
    upload: () => ({
      cancel: () => undefined,
      promise: Promise.resolve({
        attachmentId: "attachment-a",
        discard: async () => undefined,
      }),
    }),
  };
  const terminalContext = { errorCount: 0, liveCount: 0, sessionCount: 0 };
  return {
    composerAttachments: new ComposerAttachmentController({
      now: () => Date.parse("2026-08-31T22:00:00Z"),
      store: {
        delete: async () => undefined,
        deleteSavedServer: async () => undefined,
        load: async () => [],
        upsert: async () => undefined,
      },
      transport: attachmentTransport,
    }),
    commandCorrelations: (_scope: unknown, onSettlement?: (settlement: never) => void) => {
      if (onSettlement !== undefined) resource.attachSettlementObserver(onSettlement);
      return resource;
    },
    commandActivations: {
      execute: input.execute ?? (async () => completedThreadUpdate()),
    },
    commands: {
      executeCorrelated: input.executeCorrelated,
    },
    now: () => Date.parse("2026-08-31T22:00:00Z"),
    ports: () => new ObservableResource({ ports: input.ports ?? [], scannedAt: 0 }),
    projection: () => projection,
    query: (_savedServerId: unknown, query: V2Query) =>
      projectQuery(query, input.models, input.workspaceSupport),
    queries: {
      execute: async () => ({
        kind: "history.page",
        newerCursor: null,
        olderCursor: null,
        threadId: conversationThreadId,
        turns: [],
      }),
    },
    savedServers,
    sessions: {
      resource: () => projection.snapshot().value,
    },
    threadPins:
      input.threadPins ??
      new ThreadPinsResource({
        deleteSavedServer: async () => undefined,
        list: async () => [],
        setPinned: async () => undefined,
      }),
    terminal: {
      contextSnapshot: () => terminalContext,
      subscribe: () => () => undefined,
    },
    voice: new VoiceInputController({
      start: async () => ({ cancel: async () => undefined, finish: async () => undefined }),
    }),
  } as unknown as V2Runtime;
}

function projectQuery(
  query: V2Query,
  models: Extract<V2QueryResult, { kind: "models.list" }>["models"] = [],
  workspaceSupport: Extract<V2QueryResult, { kind: "workspace.inspect" }>["support"] = null,
): ObservableResource<unknown> {
  const inner = Object.assign(new ObservableResource<unknown>(null), {
    actionable: () => true,
    refresh: async () => undefined,
  });
  inner.publish({
    status: "ready",
    value: queryResult(query, models, workspaceSupport),
  });
  const outer = new ObservableResource<unknown>(null);
  outer.publish({ status: "ready", value: inner });
  return outer;
}

function queryResult(
  query: V2Query,
  models: Extract<V2QueryResult, { kind: "models.list" }>["models"],
  workspaceSupport: Extract<V2QueryResult, { kind: "workspace.inspect" }>["support"],
): V2QueryResult {
  if (query.kind === "models.list") return { kind: "models.list", models };
  if (query.kind === "accounts.list") {
    return { activeProfileId: null, allExhausted: false, kind: "accounts.list", profiles: [] };
  }
  if (query.kind === "thread.resources") {
    return {
      attachments: [],
      availableScopes: [query.scope],
      changes: [],
      kind: "thread.resources",
      revision: "resources:1",
      review: { deliveries: [], targetKinds: [] },
      scope: query.scope,
      threadId: query.threadId,
    };
  }
  if (query.kind === "workspace.inspect") {
    return { kind: "workspace.inspect", support: workspaceSupport };
  }
  if (query.kind === "queue.list") {
    return { items: [], kind: "queue.list", nextCursor: null, revision: "revision-1" };
  }
  return {
    kind: "projects.list",
    projects: [
      {
        addedAt: "2026-08-31T00:00:00Z",
        lastUsedAt: "2026-08-31T00:00:00Z",
        name: "project",
        path: "/workspace/project",
        pinned: true,
      },
    ],
  };
}

function correlationController(
  surface: "newThread" | "threadComposer" = "newThread",
  recovered = false,
) {
  let settlement:
    | ReturnType<typeof durableSettlement>
    | ReturnType<typeof completedSettlement>
    | ReturnType<typeof terminalSettlement> = durableSettlement();
  let released = false;
  const record = () => ({
    ...correlationRecord(surface),
    state: released ? ("durableReleased" as const) : ("durable" as const),
  });
  const resource = new CommandCorrelationResource(
    {
      listLocalUnsettled: async () => (recovered ? [record()] : []),
      listUnsettled: async () => (recovered ? [record()] : []),
      reconcile: async () => settlement,
      releaseScope: async () => {
        released = true;
      },
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

function conversationProjection(turns: V2TurnView[] = []): ObservableResource<unknown> {
  const idleRefreshSnapshot = { status: "idle" as const };
  const inner = Object.assign(
    new ObservableResource({
      operations: [],
      projections: {
        live: {
          currentThread: {
            newerCursor: null,
            olderCursor: null,
            thread: {
              id: "thread-a",
              settings: {
                approvalPolicy: "never",
                effort: "high",
                model: "gpt-5.6-sol",
                personality: null,
                sandbox: "unrestricted",
              },
              title: "Conversation",
            },
            turns,
          },
        },
        retained: null,
      },
      state: "live",
      version: 1,
    }),
    {
      refreshSnapshot: () => idleRefreshSnapshot,
      requestedThreadAuthority: () => ({
        message: null,
        status: "ready" as const,
        threadId: conversationThreadId,
      }),
      subscribeRefresh: () => () => undefined,
    },
  );
  inner.publish({ status: "ready", value: inner.snapshot().value });
  const outer = new ObservableResource<unknown>(null);
  outer.publish({ status: "ready", value: inner });
  return outer;
}

function runningTurn(): V2TurnView {
  return {
    activity: null,
    completedAt: null,
    createdAt: "2026-08-31T22:00:00Z",
    durationMs: null,
    id: "turn-running",
    items: [],
    lifecycle: [],
    state: "running",
    threadId: conversationThreadId,
    usage: null,
  };
}

function modelCatalog(): Extract<V2QueryResult, { kind: "models.list" }>["models"] {
  return [
    {
      defaultEffort: "high",
      efforts: ["medium", "high", "xhigh"],
      id: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      supportsPersonality: true,
    },
    {
      defaultEffort: "medium",
      efforts: ["low", "medium", "high"],
      id: "gpt-5.6-terra",
      label: "GPT-5.6 Terra",
      supportsPersonality: false,
    },
  ];
}

function completedThreadUpdate() {
  return {
    operationId: "operation-settings",
    result: {
      kind: "thread.update" as const,
      thread: { id: conversationThreadId },
    },
    type: "commandCompleted" as const,
  };
}

function completedWorkspaceCreate() {
  return {
    operationId: "operation-workspace",
    result: {
      kind: "workspace.create" as const,
      path: "/isolated/project",
      repositoryRoot: "/workspace/project",
    },
    type: "commandCompleted" as const,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
