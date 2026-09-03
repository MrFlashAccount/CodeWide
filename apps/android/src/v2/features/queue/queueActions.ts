import type {
  V2Command,
  V2CommandTerminalFrame,
  V2EditableInputBlock,
  V2InputBlock,
  V2QueueItem,
} from "@codewide/sync-client/v2";

import type { QueueRowActions } from "../../presentation/queue/queueTypes";
import { queueMoveTarget } from "./queueModel";

interface QueueActionsInput {
  actionable(): boolean;
  activeTurnId(): string | null;
  execute(command: V2Command): Promise<V2CommandTerminalFrame>;
  items(): V2QueueItem[];
  refresh(): Promise<void>;
  revision(): string;
}

/** Owns queue mutations while leaving queue rows authoritative until refresh completes. */
export class QueueActions implements QueueRowActions {
  readonly #input: QueueActionsInput;

  constructor(input: QueueActionsInput) {
    this.#input = input;
  }

  onCancel = async (itemId: string): Promise<void> => {
    this.#requireActionable();
    const item = this.#item(itemId);
    if (item.state !== "queued" && item.state !== "failed") {
      throw new Error("This queue item cannot be deleted while delivery is unresolved");
    }
    await this.#mutate({ expectedRevision: this.#input.revision(), itemId, kind: "cancel" });
  };

  onEdit = async (
    itemId: string,
    text: string,
    attachmentIds?: readonly string[],
  ): Promise<void> => {
    this.#requireActionable();
    const normalized = text.trim();
    const item = this.#input.items().find((candidate) => candidate.id === itemId);
    if (item === undefined || item.state !== "queued") {
      throw new Error("Queued prompt is no longer editable");
    }
    const input = editableInput(item.input, normalized, attachmentIds);
    if (input.length === 0) throw new Error("Queued prompt cannot be empty");
    await this.#mutate({
      editableInput: input,
      expectedRevision: this.#input.revision(),
      itemId,
      kind: "edit",
    });
  };

  onMove = async (itemId: string, offset: number): Promise<void> => {
    this.#requireActionable();
    const target = queueMoveTarget(this.#input.items(), itemId, offset);
    if (target === null) return;
    await this.#mutate({
      beforeItemId: target.beforeItemId,
      expectedRevision: this.#input.revision(),
      itemId,
      kind: "move",
    });
  };

  onRetry = async (itemId: string): Promise<void> => {
    this.#requireActionable();
    if (this.#item(itemId).state !== "failed") {
      throw new Error("Only a failed queued prompt can be retried");
    }
    await this.#mutate({ expectedRevision: this.#input.revision(), itemId, kind: "retry" });
  };

  onSteer = async (itemId: string): Promise<void> => {
    this.#requireActionable();
    const turnId = this.#input.activeTurnId();
    if (turnId === null) throw new Error("There is no active turn to steer");
    if (this.#item(itemId).state !== "queued") {
      throw new Error("Queued prompt is no longer available");
    }
    await this.#mutate({
      expectedRevision: this.#input.revision(),
      itemId,
      kind: "steer",
      turnId,
    });
  };

  async #mutate(mutation: Extract<V2Command, { kind: "queue.mutate" }>["mutation"]): Promise<void> {
    this.#requireActionable();
    const frame = await this.#input.execute({ kind: "queue.mutate", mutation });
    if (frame.type !== "commandCompleted") {
      if (frame.type === "commandFailed" && frame.error.code === "conflict") {
        await this.#input.refresh();
        throw new Error(
          "The queue changed on the server. Review the refreshed order and try again",
        );
      }
      throw commandFailure(frame);
    }
    await this.#input.refresh();
  }

  #item(itemId: string): V2QueueItem {
    const item = this.#input.items().find((candidate) => candidate.id === itemId);
    if (item === undefined) throw new Error("Queue item is no longer available");
    return item;
  }

  #requireActionable(): void {
    if (!this.#input.actionable()) {
      throw new Error("Wait for the current queue before changing queued prompts");
    }
  }
}

function editableInput(
  input: V2InputBlock[],
  text: string,
  attachmentIds: readonly string[] | undefined,
): V2EditableInputBlock[] {
  const result: V2EditableInputBlock[] = [];
  if (text !== "") result.push({ kind: "text", text });
  if (attachmentIds === undefined) {
    for (const block of input) {
      if (block.kind === "attachment") result.push(block);
    }
    return result;
  }
  for (const attachmentId of attachmentIds) result.push({ attachmentId, kind: "attachment" });
  return result;
}

function commandFailure(
  frame: Exclude<V2CommandTerminalFrame, { type: "commandCompleted" }>,
): Error {
  if (frame.type === "commandIndeterminate") {
    return new Error("The server could not determine whether this queue action completed");
  }
  return new Error(frame.error.message);
}
