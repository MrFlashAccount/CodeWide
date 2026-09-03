import type { ThreadListRow, ThreadListRowActions } from "./threadListTypes";

interface ThreadListHeaderItem {
  kind: "header";
  title: string;
}

interface ThreadListThreadItem {
  actions: ThreadListRowActions | undefined;
  kind: "thread";
  onActionError: ((message: string) => void) | undefined;
  onOpen(id: string): void;
  onPrewarm: ((id: string) => void) | undefined;
  row: ThreadListRow;
  selected: boolean;
}

export type RenderableThreadListItem = ThreadListHeaderItem | ThreadListThreadItem;

export interface ThreadListItemsInput {
  actions: ThreadListRowActions | undefined;
  onActionError: ((message: string) => void) | undefined;
  onOpen(id: string): void;
  onPrewarm: ((id: string) => void) | undefined;
  rows: ThreadListRow[];
  selectedId: string | undefined;
  showSections: boolean;
}

export function buildThreadListItems(input: ThreadListItemsInput): RenderableThreadListItem[] {
  const items: RenderableThreadListItem[] = [];
  if (!input.showSections) {
    appendThreadRows(items, input.rows, input);
    return items;
  }
  appendThreadSection(
    items,
    "Pinned",
    input.rows.filter((row) => row.pinned === true),
    input,
  );
  appendThreadSection(
    items,
    "Recent",
    input.rows.filter((row) => row.pinned !== true),
    input,
  );
  return items;
}

export function threadListItemKey(item: RenderableThreadListItem): string {
  return item.kind === "header" ? `header:${item.title}` : item.row.id;
}

export function threadListItemType(
  item: RenderableThreadListItem,
): RenderableThreadListItem["kind"] {
  return item.kind;
}

export function threadListItemsEqual(
  left: RenderableThreadListItem,
  right: RenderableThreadListItem,
): boolean {
  if (left === right) return true;
  if (left.kind === "header") return right.kind === "header" && left.title === right.title;
  if (right.kind === "header") return false;
  return (
    threadListRowsEqual(left.row, right.row) &&
    left.selected === right.selected &&
    threadListActionsEqual(left.actions, right.actions) &&
    left.onOpen === right.onOpen &&
    left.onPrewarm === right.onPrewarm &&
    left.onActionError === right.onActionError
  );
}

function threadListActionsEqual(
  left: ThreadListRowActions | undefined,
  right: ThreadListRowActions | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.archive === right.archive &&
    left.copyId === right.copyId &&
    left.markRead === right.markRead &&
    left.togglePin === right.togglePin
  );
}

function threadListRowsEqual(left: ThreadListRow, right: ThreadListRow): boolean {
  return (
    left.id === right.id &&
    left.authoritativeSearchMatch === right.authoritativeSearchMatch &&
    left.title === right.title &&
    left.preview === right.preview &&
    left.state === right.state &&
    left.updatedAt === right.updatedAt &&
    left.archived === right.archived &&
    left.pinned === right.pinned &&
    left.retained === right.retained &&
    left.latestActivityMarker === right.latestActivityMarker &&
    left.unread === right.unread
  );
}

function appendThreadSection(
  items: RenderableThreadListItem[],
  title: string,
  rows: ThreadListRow[],
  input: ThreadListItemsInput,
): void {
  if (rows.length === 0) return;
  items.push({ kind: "header", title });
  appendThreadRows(items, rows, input);
}

function appendThreadRows(
  items: RenderableThreadListItem[],
  rows: ThreadListRow[],
  input: ThreadListItemsInput,
): void {
  for (const row of rows) {
    items.push({
      actions: input.actions,
      kind: "thread",
      onActionError: input.onActionError,
      onOpen: input.onOpen,
      onPrewarm: input.onPrewarm,
      row,
      selected: row.id === input.selectedId,
    });
  }
}
