import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";

import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import { ObservableResource } from "../src/v2/application/resources/resource";
import type { V2Runtime } from "../src/v2/application/v2Runtime";
import { VoiceInputController } from "../src/v2/application/voiceInputController";
import { savedServerId } from "../src/v2/domain/ids";
import { ComposerAttachmentController } from "../src/v2/application/composer/composerAttachmentController";
import type {
  ComposerAttachmentTransport,
  ComposerAttachmentUploadInput,
  LocalComposerAttachment,
  PersistedLocalComposerAttachment,
  RunningComposerAttachmentUpload,
} from "../src/v2/application/ports/composerAttachmentTransport";
import type {
  ComposerDraftStore,
  PersistedComposerDraft,
} from "../src/v2/application/ports/composerDraftStore";
import { QueueControlsFeature } from "../src/v2/features/queue/QueueManagerFeature";
import { DeliveryModeSelectorView } from "../src/v2/presentation/queue/DeliveryModeSelectorView";
import { InlineQueueView } from "../src/v2/presentation/queue/InlineQueueView";
import { QueueSheetView } from "../src/v2/presentation/queue/QueueSheetView";
import { QueueEditorView } from "../src/v2/presentation/queue/QueueEditorView";
import { queueDragOffset } from "../src/v2/presentation/queue/QueueDragHandleView";
import type { QueueRowActions, QueueRowModel } from "../src/v2/presentation/queue/queueTypes";

describe("V2 queue presentation", () => {
  it("requests the authoritative queue for the active thread", () => {
    const { query, runtime } = queueRuntime([row("a", "queued")]);
    render(
      <V2RuntimeProvider runtime={runtime}>
        <QueueControlsFeature
          activeTurnId="turn"
          savedServerId={savedServerId("server")}
          threadId="thread"
        />
      </V2RuntimeProvider>,
    );

    expect(query).toHaveBeenCalledWith(savedServerId("server"), {
      cursor: null,
      kind: "queue.list",
      limit: 100,
      threadId: "thread",
    });
    expect(screen.getByText("a prompt")).toBeTruthy();
  });

  it("edits queue attachments through the live V2 staging controller", async () => {
    const store = new RenderDraftStore();
    const transport = new RenderAttachmentTransport();
    const composerAttachments = new ComposerAttachmentController({
      now: () => 1,
      store,
      transport,
    });
    await composerAttachments.start();
    const queued = row("a", "queued");
    queued.attachmentCount = 1;
    queued.attachments = [{ id: "retained", name: "retained-spec.md" }];
    const { execute, runtime } = queueRuntime([queued], composerAttachments);
    render(
      <V2RuntimeProvider runtime={runtime}>
        <QueueControlsFeature
          activeTurnId="turn"
          savedServerId={savedServerId("server")}
          threadId="thread"
        />
      </V2RuntimeProvider>,
    );

    fireEvent.press(screen.getByLabelText("Open queued prompts, 1 waiting"));
    fireEvent.press(screen.getByLabelText("Edit queued prompt"));
    expect(screen.getByText("retained-spec.md")).toBeTruthy();
    expect(screen.getByLabelText("Voice input")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByLabelText("Remove attachment")));
    await act(async () => fireEvent.press(screen.getByLabelText("Attach file")));
    await screen.findByText("picked.txt");
    await act(async () => fireEvent.press(screen.getByLabelText("Remove attachment")));
    expect(screen.queryByText("picked.txt")).toBeNull();

    await act(async () => fireEvent.press(screen.getByLabelText("Attach image")));
    await screen.findByLabelText("Retry attachment");
    await act(async () => fireEvent.press(screen.getByLabelText("Retry attachment")));
    await waitFor(() => expect(screen.queryByLabelText("Retry attachment")).toBeNull());
    fireEvent.press(screen.getByLabelText("Save queued prompt"));

    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(savedServerId("server"), {
        kind: "queue.mutate",
        mutation: {
          editableInput: [
            { kind: "text", text: "a prompt" },
            { attachmentId: "remote-2", kind: "attachment" },
          ],
          expectedRevision: "revision-1",
          itemId: "a",
          kind: "edit",
        },
      }),
    );
    expect(transport.released).toContain("local-1");
    await composerAttachments.dispose();
  });

  it("selects only delivery modes allowed by the current turn", () => {
    const onSelect = jest.fn();
    render(
      <DeliveryModeSelectorView
        activeTurnId="turn"
        disabled={false}
        onSelect={onSelect}
        selected="queue"
        threadRunning
      />,
    );

    fireEvent.press(screen.getByLabelText("Delivery mode: Queue"));
    expect(screen.getByLabelText("Send now").props.accessibilityState.disabled).toBe(true);
    expect(
      screen.getByLabelText("Queue after current turn").props.accessibilityState.disabled,
    ).toBe(false);
    fireEvent.press(screen.getByLabelText("Steer active turn"));
    expect(onSelect).toHaveBeenCalledWith("steer");
  });

  it("opens the authoritative queue from its inline summary", () => {
    const onOpen = jest.fn();
    render(
      <InlineQueueView
        items={[row("a", "queued"), row("b", "failed"), row("c", "queued")]}
        onOpen={onOpen}
      />,
    );
    fireEvent.press(screen.getByLabelText("Open queued prompts, 3 waiting"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText("a prompt")).toBeTruthy();
    expect(screen.getByText("b prompt")).toBeTruthy();
    expect(screen.queryByText("c prompt")).toBeNull();
  });

  it("uses the V1-equivalent long-press drag handle for multi-row reorder", async () => {
    const actions = queueActions();
    render(
      <QueueSheetView
        actions={actions}
        activeTurnId="turn"
        editingItemId={null}
        editor={null}
        items={[row("a", "queued"), row("b", "queued"), row("c", "queued")]}
        onClose={() => undefined}
        onEditRequest={() => undefined}
        visible
      />,
    );

    expect(queueDragOffset(151)).toBe(2);
    expect(queueDragOffset(-77)).toBe(-1);
    expect(screen.getAllByLabelText("Drag queued prompt")).toHaveLength(3);
    expect(screen.queryByLabelText("Move queued prompt earlier")).toBeNull();
    expect(screen.queryByLabelText("Move queued prompt later")).toBeNull();

    await act(async () => {
      fireGestureHandler(getByGestureTestId("v2-queue-drag-gesture-a"), [
        { state: State.BEGAN, translationY: 0 },
        { state: State.ACTIVE, translationY: 151 },
        { state: State.END, translationY: 151 },
      ]);
    });
    await waitFor(() => expect(actions.onMove).toHaveBeenCalledWith("a", 2));
  });

  it("keeps an accessible one-step reorder fallback on the drag handle", async () => {
    const actions = queueActions();
    render(
      <QueueSheetView
        actions={actions}
        activeTurnId="turn"
        editingItemId={null}
        editor={null}
        items={[row("a", "queued"), row("b", "queued"), row("c", "queued")]}
        onClose={() => undefined}
        onEditRequest={() => undefined}
        visible
      />,
    );

    const handle = screen.getByTestId("v2-queue-drag-handle-b");
    expect(handle.props.accessibilityValue).toEqual({ max: 3, min: 1, now: 2 });
    await act(async () => {
      fireEvent(handle, "accessibilityAction", { nativeEvent: { actionName: "decrement" } });
    });
    expect(actions.onMove).toHaveBeenCalledWith("b", -1);
  });

  it("renders a failed drag honestly and allows the user to retry", async () => {
    const actions = queueActions();
    actions.onMove.mockRejectedValueOnce(new Error("The queue changed on the server"));
    render(
      <QueueSheetView
        actions={actions}
        activeTurnId="turn"
        editingItemId={null}
        editor={null}
        items={[row("a", "queued"), row("b", "queued")]}
        onClose={() => undefined}
        onEditRequest={() => undefined}
        visible
      />,
    );

    const handle = screen.getByTestId("v2-queue-drag-handle-a");
    await act(async () => {
      fireEvent(handle, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
    });
    expect(await screen.findByText("The queue changed on the server")).toBeTruthy();

    await act(async () => {
      fireEvent(handle, "accessibilityAction", { nativeEvent: { actionName: "increment" } });
    });
    await waitFor(() => expect(actions.onMove).toHaveBeenCalledTimes(2));
  });

  it("shows an honest partial count and retries a failed continuation page", async () => {
    const loadMore = jest.fn(async () => undefined);
    render(
      <>
        <InlineQueueView
          hasMore
          items={[row("a", "queued"), row("b", "queued")]}
          onOpen={() => undefined}
        />
        <QueueSheetView
          actions={queueActions()}
          activeTurnId="turn"
          editingItemId={null}
          editor={null}
          items={[row("a", "queued"), row("b", "queued")]}
          onClose={() => undefined}
          onEditRequest={() => undefined}
          paging={{ loadMore, message: "Page request failed", status: "error" }}
          visible
        />
      </>,
    );

    expect(screen.getByText("2+ queued prompts")).toBeTruthy();
    expect(screen.getByText("2+ pending messages")).toBeTruthy();
    expect(screen.getByText("Page request failed · Retry")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByLabelText("Retry loading queued prompts")));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("renders uncertain and failed states but retries only definite failures", async () => {
    const actions = queueActions();
    render(
      <QueueSheetView
        actions={actions}
        activeTurnId="turn"
        editingItemId={null}
        editor={null}
        items={[row("uncertain", "uncertain"), row("failed", "failed")]}
        onClose={() => undefined}
        onEditRequest={() => undefined}
        visible
      />,
    );

    expect(screen.getByText("Delivery uncertain")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getAllByLabelText("Retry queued prompt")).toHaveLength(1);
    expect(
      screen.getAllByLabelText("Delete queued prompt")[0]?.props.accessibilityState.disabled,
    ).toBe(true);
    expect(
      screen.getAllByLabelText("Delete queued prompt")[1]?.props.accessibilityState.disabled,
    ).toBe(false);
    expect(screen.getByTestId("v2-queue-item-uncertain")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByLabelText("Retry queued prompt")));
    await waitFor(() => expect(actions.onRetry).toHaveBeenCalledWith("failed"));
  });

  it("edits a queued prompt and preserves the draft until the action settles", async () => {
    const save = deferred<void>();
    const actions = queueActions();
    actions.onEdit.mockImplementation(() => save.promise);
    render(
      <QueueEditorView
        attachments={[]}
        initialText="a prompt"
        onAddFile={async () => undefined}
        onAddImage={async () => undefined}
        onCancel={() => undefined}
        onRemoveAttachment={() => undefined}
        onRetryAttachment={async () => undefined}
        onSave={async (input) => actions.onEdit("a", input.text, input.retainedAttachmentIds)}
      />,
    );

    fireEvent.changeText(screen.getByLabelText("Queued prompt text"), "revised prompt");
    fireEvent.press(screen.getByLabelText("Save queued prompt"));
    expect(screen.getByLabelText("Queued prompt text").props.editable).toBe(false);
    expect(actions.onEdit).toHaveBeenCalledWith("a", "revised prompt", []);

    await act(async () => save.resolve());
    expect(screen.getByLabelText("Queued prompt text").props.editable).toBe(true);
  });

  it("allows an attachment-only queued prompt to keep empty text", async () => {
    const actions = queueActions();
    const attachment = row("attachment", "queued");
    attachment.attachmentCount = 1;
    attachment.attachments = [{ id: "attachment-a", name: "Queued attachment" }];
    attachment.editableText = "";
    render(
      <QueueEditorView
        attachments={[
          {
            error: null,
            id: "attachment-a",
            label: "Queued attachment",
            source: "retained",
            state: "ready",
          },
        ]}
        initialText=""
        onAddFile={async () => undefined}
        onAddImage={async () => undefined}
        onCancel={() => undefined}
        onRemoveAttachment={() => undefined}
        onRetryAttachment={async () => undefined}
        onSave={async (input) =>
          actions.onEdit("attachment", input.text, input.retainedAttachmentIds)
        }
      />,
    );

    expect(screen.getByLabelText("Save queued prompt").props.accessibilityState.disabled).toBe(
      false,
    );
    await act(async () => fireEvent.press(screen.getByLabelText("Save queued prompt")));
    expect(actions.onEdit).toHaveBeenCalledWith("attachment", "", ["attachment-a"]);
  });

  it("keeps a retained queue visible but disables every mutation", () => {
    const actions = queueActions();
    render(
      <QueueSheetView
        actionable={false}
        actions={actions}
        activeTurnId="turn"
        editingItemId={null}
        editor={null}
        items={[row("a", "queued"), row("failed", "failed")]}
        onClose={() => undefined}
        onEditRequest={() => undefined}
        visible
      />,
    );

    expect(screen.getByText("a prompt")).toBeTruthy();
    expect(
      screen.getAllByLabelText("Edit queued prompt")[0]?.props.accessibilityState.disabled,
    ).toBe(true);
    expect(screen.getByLabelText("Retry queued prompt").props.accessibilityState.disabled).toBe(
      true,
    );
    expect(
      screen.getAllByLabelText("Delete queued prompt")[0]?.props.accessibilityState.disabled,
    ).toBe(true);
  });
});

type MockQueueActions = {
  [Key in keyof QueueRowActions]: jest.MockedFunction<QueueRowActions[Key]>;
};

function queueActions(): MockQueueActions {
  return {
    onCancel: jest.fn(async () => undefined),
    onEdit: jest.fn(async () => undefined),
    onMove: jest.fn(async () => undefined),
    onRetry: jest.fn(async () => undefined),
    onSteer: jest.fn(async () => undefined),
  };
}

function row(id: string, state: QueueRowModel["state"]): QueueRowModel {
  return {
    attachmentCount: 0,
    attachments: [],
    editableText: `${id} prompt`,
    error: state === "failed" ? "Retry from the authoritative queue" : null,
    id,
    state,
    summary: `${id} prompt`,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

function queueRuntime(
  items: QueueRowModel[],
  composerAttachments?: ComposerAttachmentController,
): {
  execute: jest.Mock;
  query: jest.Mock;
  runtime: V2Runtime;
} {
  const queueSnapshot = {
    authority: "live" as const,
    status: "ready" as const,
    value: {
      items: items.map((item, position) => ({
        attachments: item.attachments,
        id: item.id,
        input: [
          { kind: "text" as const, text: item.editableText },
          ...item.attachments.map((attachment) => ({
            attachmentId: attachment.id,
            kind: "attachment" as const,
          })),
        ],
        lastError: item.error,
        position: String(position),
        state: item.state,
        summary: item.summary,
        threadId: "thread",
      })),
      kind: "queue.list" as const,
      nextCursor: null,
      revision: "revision-1",
    },
  };
  const resource = {
    refresh: jest.fn(async () => undefined),
    snapshot: () => queueSnapshot,
    subscribe: () => () => undefined,
  };
  const outerSnapshot = { status: "ready" as const, value: resource };
  const query = jest.fn(() => ({
    snapshot: () => outerSnapshot,
    subscribe: () => () => undefined,
  }));
  const execute = jest.fn(async () => ({
    operationId: "operation",
    result: { kind: "queue.mutate", outcome: { itemId: "a", kind: "edited" } },
    type: "commandCompleted" as const,
  }));
  const projection = new ObservableResource({
    operations: [],
    projections: {
      live: { sourceGeneration: "1" },
      retained: null,
    },
    state: "live" as const,
    version: 1,
  });
  const runtime = {
    commandActivations: { execute },
    ...(composerAttachments === undefined ? {} : { composerAttachments }),
    query,
    sessions: { resource: () => projection },
    voice: new VoiceInputController({
      start: async () => ({ cancel: async () => undefined, finish: async () => undefined }),
    }),
  } as unknown as V2Runtime;
  return { execute, query, runtime };
}

class RenderDraftStore implements ComposerDraftStore {
  readonly records = new Map<string, PersistedComposerDraft>();

  async delete(server: ReturnType<typeof savedServerId>, draftId: string): Promise<void> {
    this.records.delete(`${server}\u0000${draftId}`);
  }

  async deleteSavedServer(server: ReturnType<typeof savedServerId>): Promise<void> {
    for (const [key, record] of this.records) {
      if (record.savedServerId === server) this.records.delete(key);
    }
  }

  async load(): Promise<PersistedComposerDraft[]> {
    return [...this.records.values()];
  }

  async upsert(record: PersistedComposerDraft): Promise<void> {
    this.records.set(`${record.savedServerId}\u0000${record.draftId}`, record);
  }
}

class RenderAttachmentTransport implements ComposerAttachmentTransport {
  readonly persisted = new Map<string, LocalComposerAttachment>();
  readonly released: string[] = [];
  #nextId = 1;
  #rejectImageOnce = true;

  createBytes(name: string, mediaType: string, value: Uint8Array): LocalComposerAttachment {
    return this.local(name, mediaType, value.byteLength);
  }

  createText(name: string, mediaType: string, value: string): LocalComposerAttachment {
    return this.local(name, mediaType, value.length);
  }

  async pick(kind: "file" | "image"): Promise<LocalComposerAttachment> {
    return kind === "file"
      ? this.local("picked.txt", "text/plain", 1)
      : this.local("picked.png", "image/png", 1);
  }

  reference(attachment: LocalComposerAttachment): PersistedLocalComposerAttachment {
    this.persisted.set(attachment.handle, attachment);
    return {
      mediaType: attachment.mediaType,
      name: attachment.name,
      sizeBytes: attachment.sizeBytes,
      token: attachment.handle,
    };
  }

  release(attachment: LocalComposerAttachment): void {
    this.released.push(attachment.handle);
  }

  restore(reference: PersistedLocalComposerAttachment): LocalComposerAttachment | null {
    return this.persisted.get(reference.token) ?? null;
  }

  upload(input: ComposerAttachmentUploadInput): RunningComposerAttachmentUpload {
    const uploadNumber = this.#nextId - 1;
    if (input.attachment.mediaType === "image/png" && this.#rejectImageOnce) {
      this.#rejectImageOnce = false;
      return { cancel: () => undefined, promise: Promise.reject(new Error("offline")) };
    }
    return {
      cancel: () => undefined,
      promise: Promise.resolve({
        attachmentId: `remote-${uploadNumber}`,
        discard: async () => undefined,
      }),
    };
  }

  private local(name: string, mediaType: string, sizeBytes: number): LocalComposerAttachment {
    const handle = `local-${this.#nextId}`;
    this.#nextId += 1;
    return { handle, mediaType, name, sizeBytes };
  }
}
