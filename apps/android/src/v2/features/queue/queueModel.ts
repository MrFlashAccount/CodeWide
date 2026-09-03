import type { V2QueueItem } from "@codewide/sync-client/v2";

import type {
  QueueRowAttachmentModel,
  QueueRowModel,
  QueueRowState,
} from "../../presentation/queue/queueTypes";

export interface QueueMoveTarget {
  beforeItemId: string | null;
}

export function queueRows(items: V2QueueItem[]): QueueRowModel[] {
  const visible = items.filter(isVisibleQueueItem);
  visible.sort(compareQueueItems);
  return visible.map(queueRow);
}

export function queueMoveTarget(
  items: V2QueueItem[],
  itemId: string,
  offset: number,
): QueueMoveTarget | null {
  const queued = items.filter(isQueuedItem);
  queued.sort(compareQueueItems);
  const index = queued.findIndex((item) => item.id === itemId);
  if (index < 0 || !Number.isFinite(offset)) return null;
  const targetIndex = clamp(index + Math.trunc(offset), 0, queued.length - 1);
  if (targetIndex === index) return null;
  if (targetIndex < index) return { beforeItemId: queued[targetIndex]?.id ?? null };
  return { beforeItemId: queued[targetIndex + 1]?.id ?? null };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function isVisibleQueueItem(item: V2QueueItem): boolean {
  return item.state !== "done";
}

function isQueuedItem(item: V2QueueItem): boolean {
  return item.state === "queued";
}

function queueRow(item: V2QueueItem): QueueRowModel {
  const attachments = queueAttachments(item);
  return {
    attachmentCount: attachments.length,
    attachments,
    editableText: editableText(item),
    error: item.lastError,
    id: item.id,
    state: queueRowState(item),
    summary: item.summary,
  };
}

function queueAttachments(item: V2QueueItem): QueueRowAttachmentModel[] {
  const names = new Map(item.attachments.map((attachment) => [attachment.id, attachment.name]));
  const result: QueueRowAttachmentModel[] = [];
  for (const block of item.input) {
    if (block.kind !== "attachment") continue;
    const name = names.get(block.attachmentId);
    if (name === undefined) throw new Error("Queue attachment display metadata is missing");
    result.push({ id: block.attachmentId, name });
  }
  if (result.length !== item.attachments.length) {
    throw new Error("Queue attachment display metadata does not match its input");
  }
  return result;
}

function queueRowState(item: V2QueueItem): QueueRowState {
  if (item.state === "failed") return "failed";
  if (item.state === "uncertain") return "uncertain";
  if (item.state === "running") return "running";
  return "queued";
}

function editableText(item: V2QueueItem): string {
  for (const block of item.input) {
    if (block.kind === "text") return block.text;
  }
  return "";
}

function compareQueueItems(left: V2QueueItem, right: V2QueueItem): number {
  return compareU64(left.position, right.position);
}

function compareU64(left: string, right: string): number {
  const normalizedLeft = normalizeU64(left);
  const normalizedRight = normalizeU64(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length - normalizedRight.length;
  }
  return normalizedLeft.localeCompare(normalizedRight);
}

function normalizeU64(value: string): string {
  const normalized = value.replace(/^0+(?=\d)/, "");
  return normalized === "" ? "0" : normalized;
}
