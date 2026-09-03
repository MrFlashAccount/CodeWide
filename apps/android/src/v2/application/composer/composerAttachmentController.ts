import type { SavedServerId } from "../../domain/ids";
import type {
  ComposerAttachmentTarget,
  ComposerAttachmentTransport,
  LocalComposerAttachment,
} from "../ports/composerAttachmentTransport";
import type {
  ComposerDraftStore,
  PersistedComposerDraft,
  PersistedComposerDraftAttachment,
  PersistedNewThreadDraft,
} from "../ports/composerDraftStore";
import { ObservableResource } from "../resources/resource";
import { ComposerAttachmentDraft } from "./composerAttachmentDraft";

export interface ComposerAttachmentDraftScope {
  draftId: string;
  newThread?: PersistedNewThreadDraft;
  savedServerId: SavedServerId;
  target: ComposerAttachmentTarget;
}

interface ComposerAttachmentControllerInput {
  now(): number;
  store: ComposerDraftStore;
  transport: ComposerAttachmentTransport;
}

export interface ComposerDraftLocalState {
  deliveryMode: PersistedComposerDraft["deliveryMode"];
  historyAnchorOffsetPx: number | null;
  historyAnchorTurnId: string | null;
  historyGenerationId: string | null;
  historyPageCursor: string | null;
  historyPageDirection: PersistedComposerDraft["historyPageDirection"];
  newThread: PersistedNewThreadDraft | null;
  persisted: boolean;
  text: string;
}

export interface ComposerHistoryPosition {
  anchorOffsetPx: number | null;
  anchorTurnId: string | null;
  generationId: string | null;
  pageCursor: string | null;
  pageDirection: PersistedComposerDraft["historyPageDirection"];
}

/** Owns process-local composer drafts; no draft item is a server projection. */
export class ComposerAttachmentController {
  readonly #drafts = new Map<string, ComposerAttachmentDraft>();
  readonly #dirty = new Set<string>();
  readonly #now: () => number;
  readonly #records = new Map<string, PersistedComposerDraft>();
  readonly #persisted = new Set<string>();
  readonly #resources = new Map<string, ObservableResource<ComposerDraftLocalState>>();
  readonly #store: ComposerDraftStore;
  readonly #transport: ComposerAttachmentTransport;
  #writeTail = Promise.resolve();

  constructor(input: ComposerAttachmentControllerInput) {
    this.#now = input.now;
    this.#store = input.store;
    this.#transport = input.transport;
  }

  async start(): Promise<void> {
    for (const record of await this.#store.load()) {
      const key = draftKey(record.savedServerId, record.draftId);
      if (this.#dirty.has(key)) continue;
      this.#records.set(key, record);
      this.#persisted.add(key);
      this.#drafts.get(key)?.restore(record.attachments);
      this.#publish(key, record);
    }
  }

  draft(scope: ComposerAttachmentDraftScope): ComposerAttachmentDraft {
    const key = draftKey(scope.savedServerId, scope.draftId);
    const current = this.#drafts.get(key);
    if (current !== undefined) {
      current.setTarget(scope.target);
      return current;
    }
    const draft = new ComposerAttachmentDraft({
      ...(this.#records.get(key) === undefined
        ? {}
        : { initialAttachments: this.#records.get(key)?.attachments ?? [] }),
      now: this.#now,
      onChange: (attachments) => this.#updateAttachments(scope, attachments),
      savedServerId: scope.savedServerId,
      target: scope.target,
      transport: this.#transport,
    });
    this.#drafts.set(key, draft);
    return draft;
  }

  state(scope: ComposerAttachmentDraftScope): ObservableResource<ComposerDraftLocalState> {
    const key = draftKey(scope.savedServerId, scope.draftId);
    const current = this.#resources.get(key);
    if (current !== undefined) return current;
    const resource = new ObservableResource(
      localState(this.#record(scope), this.#persisted.has(key)),
    );
    this.#resources.set(key, resource);
    return resource;
  }

  setDeliveryMode(
    scope: ComposerAttachmentDraftScope,
    deliveryMode: PersistedComposerDraft["deliveryMode"],
  ): void {
    this.#replace(scope, { ...this.#record(scope), deliveryMode, updatedAtMs: this.#now() });
  }

  setHistoryPosition(scope: ComposerAttachmentDraftScope, position: ComposerHistoryPosition): void {
    if (!validHistoryPosition(position)) return;
    const current = this.#record(scope);
    if (sameHistoryPosition(current, position)) return;
    this.#replace(scope, {
      ...current,
      historyAnchorOffsetPx: position.anchorOffsetPx,
      historyAnchorTurnId: position.anchorTurnId,
      historyGenerationId: position.generationId,
      historyPageCursor: position.pageCursor,
      historyPageDirection: position.pageDirection,
      updatedAtMs: this.#now(),
    });
  }

  setNewThread(
    scope: ComposerAttachmentDraftScope,
    newThread: PersistedNewThreadDraft | null,
  ): void {
    const current = this.#record(scope);
    if (sameNewThread(current.newThread, newThread)) return;
    this.#replace(scope, { ...current, newThread, updatedAtMs: this.#now() });
  }

  setText(scope: ComposerAttachmentDraftScope, text: string): void {
    if (text.length > 2_000_000) throw new Error("Composer draft text is too large");
    const current = this.#record(scope);
    const key = draftKey(scope.savedServerId, scope.draftId);
    if (current.text === text && this.#persisted.has(key)) return;
    this.#replace(scope, { ...current, text, updatedAtMs: this.#now() });
  }

  /** Removes one abandoned local editor draft after its attachment lifecycle has settled. */
  async discard(scope: ComposerAttachmentDraftScope): Promise<void> {
    const key = draftKey(scope.savedServerId, scope.draftId);
    this.#drafts.get(key)?.suspend();
    await this.#writeTail;
    await this.#store.delete(scope.savedServerId, scope.draftId);
    this.#drafts.delete(key);
    this.#records.delete(key);
    this.#dirty.delete(key);
    this.#persisted.delete(key);
    this.#resources.get(key)?.publish({
      status: "ready",
      value: localState(emptyRecord(scope, this.#now()), false),
    });
  }

  async deleteSavedServer(savedServerId: SavedServerId): Promise<void> {
    const materializedDraftKeys = new Set<string>();
    for (const [key, draft] of this.#drafts) {
      if (this.#records.get(key)?.savedServerId === savedServerId) {
        draft.clear();
        this.#drafts.delete(key);
        materializedDraftKeys.add(key);
      }
    }
    for (const [key, record] of this.#records) {
      if (record.savedServerId !== savedServerId || materializedDraftKeys.has(key)) continue;
      for (const attachment of record.attachments) {
        let local: LocalComposerAttachment | null = null;
        try {
          local = this.#transport.restore(attachment.local);
        } catch {
          // Invalid local references must not block deleting the saved-server namespace.
        }
        if (local !== null) this.#transport.release(local);
      }
    }
    await this.#writeTail;
    await this.#store.deleteSavedServer(savedServerId);
    for (const [key, record] of this.#records) {
      if (record.savedServerId !== savedServerId) continue;
      this.#records.delete(key);
      this.#resources.delete(key);
      this.#dirty.delete(key);
      this.#persisted.delete(key);
    }
  }

  async dispose(): Promise<void> {
    for (const draft of this.#drafts.values()) draft.suspend();
    this.#drafts.clear();
    await this.#writeTail;
    this.#resources.clear();
    this.#records.clear();
    this.#dirty.clear();
    this.#persisted.clear();
  }

  #updateAttachments(
    scope: ComposerAttachmentDraftScope,
    attachments: PersistedComposerDraftAttachment[],
  ): void {
    const current = this.#record(scope);
    this.#replace(scope, {
      ...current,
      attachments,
      newThread: current.newThread ?? scope.newThread ?? null,
      updatedAtMs: this.#now(),
    });
  }

  #record(scope: ComposerAttachmentDraftScope): PersistedComposerDraft {
    const key = draftKey(scope.savedServerId, scope.draftId);
    const current = this.#records.get(key);
    if (current !== undefined) return current;
    const created = emptyRecord(scope, this.#now());
    this.#records.set(key, created);
    return created;
  }

  #replace(scope: ComposerAttachmentDraftScope, next: PersistedComposerDraft): void {
    const key = draftKey(scope.savedServerId, scope.draftId);
    this.#dirty.add(key);
    this.#persisted.add(key);
    this.#records.set(key, next);
    this.#publish(key, next);
    const write = this.#writeTail.then(() => this.#store.upsert(next));
    this.#writeTail = write.catch(() => undefined);
    write.catch(() => {
      this.#resources.get(key)?.publish({
        message: "Could not save the local draft",
        status: "error",
        value: localState(next, true),
      });
    });
  }

  #publish(key: string, record: PersistedComposerDraft): void {
    this.#resources
      .get(key)
      ?.publish({ status: "ready", value: localState(record, this.#persisted.has(key)) });
  }
}

function emptyRecord(
  scope: ComposerAttachmentDraftScope,
  updatedAtMs: number,
): PersistedComposerDraft {
  return {
    attachments: [],
    deliveryMode: "sendNow",
    draftId: scope.draftId,
    historyAnchorOffsetPx: null,
    historyAnchorTurnId: null,
    historyGenerationId: null,
    historyPageCursor: null,
    historyPageDirection: null,
    newThread: scope.newThread ?? null,
    savedServerId: scope.savedServerId,
    text: "",
    updatedAtMs,
  };
}

function localState(record: PersistedComposerDraft, persisted: boolean): ComposerDraftLocalState {
  return {
    deliveryMode: record.deliveryMode,
    historyAnchorOffsetPx: record.historyAnchorOffsetPx,
    historyAnchorTurnId: record.historyAnchorTurnId,
    historyGenerationId: record.historyGenerationId,
    historyPageCursor: record.historyPageCursor,
    historyPageDirection: record.historyPageDirection,
    newThread: record.newThread,
    persisted,
    text: record.text,
  };
}

function validHistoryPosition(position: ComposerHistoryPosition): boolean {
  if (position.anchorTurnId === null) {
    return (
      position.anchorOffsetPx === null &&
      position.generationId === null &&
      position.pageCursor === null &&
      position.pageDirection === null
    );
  }
  if (position.anchorTurnId.length > 256) return false;
  if (
    position.anchorOffsetPx !== null &&
    (!Number.isFinite(position.anchorOffsetPx) || Math.abs(position.anchorOffsetPx) > 10_000_000)
  ) {
    return false;
  }
  const noPage =
    position.generationId === null &&
    position.pageCursor === null &&
    position.pageDirection === null;
  const completePage =
    position.generationId !== null &&
    position.generationId.length <= 256 &&
    position.pageCursor !== null &&
    position.pageCursor.length <= 4096 &&
    position.pageDirection !== null;
  return noPage || completePage;
}

function sameHistoryPosition(
  record: PersistedComposerDraft,
  position: ComposerHistoryPosition,
): boolean {
  return (
    record.historyAnchorOffsetPx === position.anchorOffsetPx &&
    record.historyAnchorTurnId === position.anchorTurnId &&
    record.historyGenerationId === position.generationId &&
    record.historyPageCursor === position.pageCursor &&
    record.historyPageDirection === position.pageDirection
  );
}

function draftKey(savedServerId: SavedServerId, draftId: string): string {
  if (draftId.length === 0 || draftId.length > 512) {
    throw new Error("Composer draft ID is invalid");
  }
  return `${savedServerId}\u0000${draftId}`;
}

function sameNewThread(
  left: PersistedNewThreadDraft | null,
  right: PersistedNewThreadDraft | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.workspace === right.workspace &&
    sameWorkspaceMode(left.workspaceMode, right.workspaceMode) &&
    sameThreadSettings(left.settings, right.settings)
  );
}

function sameWorkspaceMode(
  left: PersistedNewThreadDraft["workspaceMode"],
  right: PersistedNewThreadDraft["workspaceMode"],
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "current" || right.kind === "current") return true;
  return (
    left.support.canCreate === right.support.canCreate &&
    left.support.provider === right.support.provider &&
    left.support.repositoryRoot === right.support.repositoryRoot
  );
}

function sameThreadSettings(
  left: PersistedNewThreadDraft["settings"],
  right: PersistedNewThreadDraft["settings"],
): boolean {
  return (
    left.model === right.model &&
    left.effort === right.effort &&
    left.personality === right.personality &&
    sameApprovalPolicy(left.approvalPolicy, right.approvalPolicy) &&
    sameSandbox(left.sandbox, right.sandbox)
  );
}

function sameApprovalPolicy(
  left: PersistedNewThreadDraft["settings"]["approvalPolicy"],
  right: PersistedNewThreadDraft["settings"]["approvalPolicy"],
): boolean {
  if (typeof left !== "object" || typeof right !== "object") return left === right;
  return (
    left.granular.mcpElicitations === right.granular.mcpElicitations &&
    left.granular.requestPermissions === right.granular.requestPermissions &&
    left.granular.rules === right.granular.rules &&
    left.granular.sandboxApproval === right.granular.sandboxApproval &&
    left.granular.skillApproval === right.granular.skillApproval
  );
}

function sameSandbox(
  left: PersistedNewThreadDraft["settings"]["sandbox"],
  right: PersistedNewThreadDraft["settings"]["sandbox"],
): boolean {
  if (typeof left !== "object" || typeof right !== "object") return left === right;
  return left.networkAccess === right.networkAccess;
}
