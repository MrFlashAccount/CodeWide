import { describe, expect, it, vi } from "vitest";

import { captureLargePaste } from "../src/v2/application/composer/captureLargePaste";
import { ComposerAttachmentDraft } from "../src/v2/application/composer/composerAttachmentDraft";
import { ComposerAttachmentController } from "../src/v2/application/composer/composerAttachmentController";
import type {
  ComposerDraftStore,
  PersistedComposerDraft,
} from "../src/v2/application/ports/composerDraftStore";
import type {
  ComposerAttachmentTransport,
  ComposerAttachmentUploadInput,
  LocalComposerAttachment,
  PersistedLocalComposerAttachment,
  RunningComposerAttachmentUpload,
} from "../src/v2/application/ports/composerAttachmentTransport";
import { savedServerId, threadId } from "../src/v2/domain/ids";

describe("V2 composer attachments", () => {
  it("stages new-thread files only when authoritative input is prepared", async () => {
    const transport = new FakeAttachmentTransport();
    const draft = createDraft(transport, null);

    const localId = await draft.attachText("notes.txt", "text/plain", "evidence");
    expect(localId).toBe("local-1");
    expect(transport.uploads).toHaveLength(0);

    const input = await draft.prepareInput("inspect this", {
      threadId: null,
      workspace: "/workspace/project",
    });

    expect(transport.uploads).toHaveLength(1);
    expect(transport.uploads[0]?.target).toEqual({
      threadId: null,
      workspace: "/workspace/project",
    });
    expect(input).toEqual([
      { kind: "text", text: "inspect this" },
      { attachmentId: "remote-1", kind: "attachment" },
    ]);
  });

  it("keeps a failed upload visible and retries the same draft item", async () => {
    const transport = new FakeAttachmentTransport();
    transport.failNextUpload = true;
    const draft = createDraft(transport, threadId("thread-1"));

    await expect(draft.attachText("failure.txt", "text/plain", "retry me")).rejects.toThrow(
      "offline",
    );
    expect(draft.snapshot().value.items).toMatchObject([
      { id: "local-1", state: "error", error: "offline" },
    ]);

    await draft.retry("local-1");
    expect(draft.snapshot().value.items).toMatchObject([
      { id: "local-1", state: "ready", error: null },
    ]);
    expect(transport.uploads).toHaveLength(2);
  });

  it("makes a synchronous staging failure terminal and retryable", async () => {
    const transport = new FakeAttachmentTransport();
    transport.throwNextUpload = true;
    const draft = createDraft(transport, threadId("thread-1"));

    await expect(draft.attachText("failure.txt", "text/plain", "retry me")).rejects.toThrow(
      "staging unavailable",
    );
    expect(draft.snapshot().value.items).toMatchObject([
      { id: "local-1", state: "error", error: "staging unavailable" },
    ]);

    await draft.retry("local-1");
    expect(draft.snapshot().value.items).toMatchObject([
      { id: "local-1", state: "ready", error: null },
    ]);
  });

  it("replaces bytes without changing the editor-owned draft identity", async () => {
    const transport = new FakeAttachmentTransport();
    const draft = createDraft(transport, null);
    const metadata = {
      kind: "quickdraw" as const,
      mode: "drawing" as const,
      revision: 1,
      snapshot: "first",
    };
    const localId = await draft.attachBytes(
      "drawing.png",
      "image/png",
      new Uint8Array([1]),
      metadata,
    );

    await draft.replaceBytes(localId, "drawing.png", "image/png", new Uint8Array([2]), {
      ...metadata,
      revision: 2,
      snapshot: "second",
    });

    expect(draft.snapshot().value.items).toMatchObject([
      { id: localId, editor: { revision: 2, snapshot: "second" }, state: "selected" },
    ]);
    expect(transport.released).toEqual(["local-1"]);
  });

  it("deletes abandoned server staging but preserves accepted staging", async () => {
    const transport = new FakeAttachmentTransport();
    const abandoned = createDraft(transport, threadId("thread-1"));
    const abandonedId = await abandoned.attachText("abandoned.txt", "text/plain", "remove");
    abandoned.remove(abandonedId);
    await Promise.resolve();
    expect(transport.discarded).toEqual(["remote-1"]);

    const accepted = createDraft(transport, threadId("thread-2"));
    await accepted.attachText("accepted.txt", "text/plain", "submit");
    accepted.commit();
    await Promise.resolve();
    expect(transport.discarded).toEqual(["remote-1"]);
  });

  it("captures the original clipboard payload before TextInput truncation", () => {
    const pasted = "x".repeat(12);
    expect(captureLargePaste("before after", pasted, { start: 7, end: 7 }, 10)).toEqual({
      attachmentText: pasted,
      draftText: "before after",
      insertionOffset: 7,
      pastedDraftText: `before ${pasted}after`,
    });
  });

  it("restores V2 draft text, delivery, history anchor, and local attachment references", async () => {
    const store = new MemoryComposerDraftStore();
    const transport = new FakeAttachmentTransport();
    const scope = {
      draftId: "thread:thread-1",
      savedServerId: savedServerId("server-1"),
      target: { threadId: threadId("thread-1"), workspace: "/workspace/project" },
    };
    const first = new ComposerAttachmentController({ now: () => 10, store, transport });
    await first.start();
    first.setText(scope, "durable draft");
    first.setDeliveryMode(scope, "queue");
    first.setHistoryPosition(scope, {
      anchorOffsetPx: 24,
      anchorTurnId: "turn-17",
      generationId: "generation-1",
      pageCursor: "cursor-1",
      pageDirection: "older",
    });
    await first.draft(scope).attachText("notes.txt", "text/plain", "evidence");
    await first.dispose();

    const restarted = new ComposerAttachmentController({ now: () => 20, store, transport });
    const restoredState = restarted.state(scope);
    const restoredAttachments = restarted.draft(scope);
    await restarted.start();

    expect(restoredState.snapshot().value).toEqual({
      deliveryMode: "queue",
      historyAnchorOffsetPx: 24,
      historyAnchorTurnId: "turn-17",
      historyGenerationId: "generation-1",
      historyPageCursor: "cursor-1",
      historyPageDirection: "older",
      newThread: null,
      persisted: true,
      text: "durable draft",
    });
    expect(restoredAttachments.snapshot().value.items).toMatchObject([
      { mediaType: "text/plain", name: "notes.txt", state: "ready" },
    ]);
  });

  it("restores an exact per-server New Thread draft and clears it only after completion", async () => {
    const store = new MemoryComposerDraftStore();
    const transport = new FakeAttachmentTransport();
    const server = savedServerId("server-new-thread");
    const scope = {
      draftId: `new-thread:${server}`,
      savedServerId: server,
      target: { threadId: null, workspace: "/workspace/project" },
    };
    const newThread = {
      settings: {
        approvalPolicy: {
          granular: {
            mcpElicitations: false,
            requestPermissions: true,
            rules: false,
            sandboxApproval: true,
            skillApproval: false,
          },
        },
        effort: "ultra" as const,
        model: "gpt-5.6-sol",
        personality: "pragmatic" as const,
        sandbox: { networkAccess: "enabled" as const, type: "externalSandbox" as const },
      },
      workspace: "/workspace/project",
      workspaceMode: {
        kind: "isolated" as const,
        support: { canCreate: true, provider: "git", repositoryRoot: "/workspace/project" },
      },
    };
    const first = new ComposerAttachmentController({ now: () => 10, store, transport });
    await first.start();
    first.setNewThread(scope, newThread);
    first.setText(scope, "durable new thread");
    await first.draft({ ...scope, newThread }).attachText("notes.txt", "text/plain", "evidence");
    await first.dispose();

    const restarted = new ComposerAttachmentController({ now: () => 20, store, transport });
    await restarted.start();

    expect(restarted.state(scope).snapshot().value).toMatchObject({
      newThread,
      persisted: true,
      text: "durable new thread",
    });
    expect(restarted.draft(scope).snapshot().value.items).toMatchObject([
      { mediaType: "text/plain", name: "notes.txt" },
    ]);
    expect(
      restarted
        .state({
          draftId: scope.draftId,
          savedServerId: savedServerId("server-other"),
          target: scope.target,
        })
        .snapshot().value.newThread,
    ).toBeNull();

    restarted.draft(scope).commit();
    restarted.setText(scope, "");
    restarted.setNewThread(scope, null);
    await restarted.dispose();
    const afterCompletion = new ComposerAttachmentController({ now: () => 30, store, transport });
    await afterCompletion.start();

    expect(afterCompletion.state(scope).snapshot().value).toMatchObject({
      newThread: null,
      text: "",
    });
    expect(afterCompletion.draft(scope).snapshot().value.items).toEqual([]);
  });

  it("purges a stored attachment reference when its durable file is unavailable", async () => {
    const store = new MemoryComposerDraftStore();
    const server = savedServerId("server-1");
    const scope = {
      draftId: "thread:thread-1",
      savedServerId: server,
      target: { threadId: threadId("thread-1"), workspace: "/workspace/project" },
    };
    await store.upsert({
      attachments: [
        {
          editor: null,
          error: null,
          local: {
            mediaType: "text/plain",
            name: "missing.txt",
            sizeBytes: 7,
            token: "missing-file",
          },
          remoteId: null,
          state: "selected",
        },
      ],
      deliveryMode: "sendNow",
      draftId: scope.draftId,
      historyAnchorOffsetPx: null,
      historyAnchorTurnId: null,
      historyGenerationId: null,
      historyPageCursor: null,
      historyPageDirection: null,
      newThread: null,
      savedServerId: server,
      text: "keep text",
      updatedAtMs: 1,
    });
    const controller = new ComposerAttachmentController({
      now: () => 10,
      store,
      transport: new FakeAttachmentTransport(),
    });

    await controller.start();
    expect(controller.draft(scope).snapshot().value.items).toEqual([]);
    await controller.dispose();

    expect([...store.records.values()]).toMatchObject([{ attachments: [], text: "keep text" }]);
  });

  it("deletes a queue-editor draft after its local attachment lifecycle settles", async () => {
    const store = new MemoryComposerDraftStore();
    const transport = new FakeAttachmentTransport();
    const scope = {
      draftId: "queue:thread-1:item-1",
      savedServerId: savedServerId("server-1"),
      target: { threadId: threadId("thread-1"), workspace: null },
    };
    const controller = new ComposerAttachmentController({ now: () => 10, store, transport });
    await controller.start();
    controller.setText(scope, "queue edit");
    const draft = controller.draft(scope);
    await draft.attachText("notes.txt", "text/plain", "evidence");

    draft.commit();
    await controller.discard(scope);

    expect(store.records.size).toBe(0);
    expect(controller.state(scope).snapshot().value).toEqual({
      deliveryMode: "sendNow",
      historyAnchorOffsetPx: null,
      historyAnchorTurnId: null,
      historyGenerationId: null,
      historyPageCursor: null,
      historyPageDirection: null,
      newThread: null,
      persisted: false,
      text: "",
    });
  });

  it("releases durable attachment files when their saved server is deleted", async () => {
    const store = new MemoryComposerDraftStore();
    const transport = new FakeAttachmentTransport();
    const server = savedServerId("server-1");
    const scope = {
      draftId: "thread:thread-1",
      savedServerId: server,
      target: { threadId: threadId("thread-1"), workspace: null },
    };
    const first = new ComposerAttachmentController({ now: () => 10, store, transport });
    await first.start();
    await first.draft(scope).attachText("notes.txt", "text/plain", "evidence");
    await first.dispose();
    transport.released.length = 0;
    const restarted = new ComposerAttachmentController({ now: () => 20, store, transport });
    await restarted.start();

    await restarted.deleteSavedServer(server);

    expect(transport.released).toHaveLength(1);
    expect(store.records.size).toBe(0);
  });
});

function createDraft(
  transport: ComposerAttachmentTransport,
  id: ReturnType<typeof threadId> | null,
) {
  return new ComposerAttachmentDraft({
    now: () => Date.parse("2026-09-03T00:00:00.000Z"),
    savedServerId: savedServerId("server-1"),
    target: { threadId: id, workspace: "/workspace/project" },
    transport,
  });
}

class FakeAttachmentTransport implements ComposerAttachmentTransport {
  failNextUpload = false;
  throwNextUpload = false;
  readonly discarded: string[] = [];
  readonly released: string[] = [];
  readonly uploads: ComposerAttachmentUploadInput[] = [];
  readonly persisted = new Map<string, LocalComposerAttachment>();
  #nextId = 1;

  createBytes(name: string, mediaType: string, value: Uint8Array): LocalComposerAttachment {
    return this.local(name, mediaType, value.byteLength);
  }

  createText(name: string, mediaType: string, value: string): LocalComposerAttachment {
    return this.local(name, mediaType, value.length);
  }

  async pick(): Promise<LocalComposerAttachment | null> {
    return this.local("picked.txt", "text/plain", 6);
  }

  release(attachment: LocalComposerAttachment): void {
    this.released.push(attachment.handle);
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

  restore(reference: PersistedLocalComposerAttachment): LocalComposerAttachment | null {
    return this.persisted.get(reference.token) ?? null;
  }

  upload(input: ComposerAttachmentUploadInput): RunningComposerAttachmentUpload {
    this.uploads.push(input);
    if (this.throwNextUpload) {
      this.throwNextUpload = false;
      throw new Error("staging unavailable");
    }
    input.onProgress({
      phase: "hashing",
      totalBytes: input.attachment.sizeBytes,
      transferredBytes: input.attachment.sizeBytes,
    });
    const failure = this.failNextUpload;
    this.failNextUpload = false;
    return {
      cancel: vi.fn(),
      promise: failure
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(this.uploadResult(`remote-${this.uploads.length}`)),
    };
  }

  private local(name: string, mediaType: string, sizeBytes: number): LocalComposerAttachment {
    const handle = `local-${this.#nextId}`;
    this.#nextId += 1;
    return { handle, mediaType, name, sizeBytes };
  }

  private uploadResult(attachmentId: string) {
    return {
      attachmentId,
      discard: async () => {
        this.discarded.push(attachmentId);
      },
    };
  }
}

class MemoryComposerDraftStore implements ComposerDraftStore {
  readonly records = new Map<string, PersistedComposerDraft>();

  async delete(savedServerId: ReturnType<typeof savedServerId>, draftId: string): Promise<void> {
    this.records.delete(`${savedServerId}\u0000${draftId}`);
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
