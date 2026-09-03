import type { V2Item, V2ThreadWindow, V2TurnView, V2Attachment } from "@codewide/sync-client/v2";

import type {
  TimelineDisplayActivity,
  TimelineDisplayResponseRow,
  TimelineDisplayTurn,
} from "../../presentation/conversation/timelineTypes";
import {
  activityDisplayModel,
  lifecycleActivityDisplayModel,
} from "./timelineActivityDisplayModel";
import { userInputDisplayModel } from "./userInputDisplayModel";

/** @testOnly Exposes rich activity normalization to its black-box rendering regressions. */
export { activityDisplayModel } from "./timelineActivityDisplayModel";

export function timelineDisplayModel(window: V2ThreadWindow | null): TimelineDisplayTurn[] {
  return timelineTurnsDisplayModel(window?.turns ?? []);
}

export function timelineTurnsDisplayModel(
  turns: V2TurnView[],
  attachments: readonly V2Attachment[] = [],
): TimelineDisplayTurn[] {
  return turns.map((turn) => {
    const lifecycle = latestPreTurnLifecycle(turn);
    const lifecycleIds = new Set(lifecycle.map((item) => item.id));
    const lifecycleByItem = latestLifecycleByItem(turn);
    const responseRows = responseRowsDisplayModel(turn.items, lifecycleIds, lifecycleByItem);
    const activities = responseRows.flatMap((row) =>
      row.kind === "activity" ? [row.activity] : [],
    );
    const assistantRows = responseRows.flatMap((row) => (row.kind === "assistant" ? [row] : []));
    const latestAssistantItem = assistantRows.at(-1);
    const userInput = userInputDisplayModel(turn.items, attachments);
    return {
      activityCount:
        turn.activity === null
          ? activities.length
          : Math.max(0, turn.activity.count - lifecycle.length),
      activities,
      ...(latestAssistantItem === undefined ? {} : { assistantItemId: latestAssistantItem.id }),
      assistantText: assistantRows.map((item) => item.text),
      completedAt: turn.completedAt,
      createdAt: turn.createdAt,
      durationMs: turn.durationMs,
      id: turn.id,
      lifecycle,
      responseRows,
      state: turn.state,
      usage: turn.usage,
      userInput,
      userText: userInput.flatMap((block) => (block.kind === "text" ? [block.text] : [])),
    };
  });
}

export function timelineResponseRowsDisplayModel(items: V2Item[]): TimelineDisplayResponseRow[] {
  return responseRowsDisplayModel(items, new Set(), new Map());
}

function responseRowsDisplayModel(
  items: V2Item[],
  excludedItemIds: ReadonlySet<string>,
  lifecycleByItem: ReadonlyMap<string, V2TurnView["lifecycle"][number]>,
): TimelineDisplayResponseRow[] {
  const rows: TimelineDisplayResponseRow[] = [];
  for (const item of items) {
    if (item.kind === "userMessage" || excludedItemIds.has(item.id)) continue;
    if (item.kind === "assistantText") {
      rows.push({
        id: item.id,
        kind: "assistant",
        memoryCitation: item.memoryCitation ?? null,
        text: item.text,
      });
      continue;
    }
    const lifecycle = lifecycleByItem.get(item.id);
    for (const activity of lifecycle === undefined
      ? activityDisplayModel(item)
      : lifecycleActivityDisplayModel(lifecycle)) {
      rows.push({ activity, id: activity.id, kind: "activity" });
    }
  }
  return rows;
}

function latestPreTurnLifecycle(turn: V2TurnView): TimelineDisplayActivity[] {
  const lifecycleByItem = new Map<string, V2TurnView["lifecycle"][number]>();
  for (const lifecycle of turn.lifecycle) {
    if (!lifecycle.preTurn) continue;
    lifecycleByItem.set(lifecycle.item.id, lifecycle);
  }
  return [...lifecycleByItem.values()].flatMap(lifecycleActivityDisplayModel);
}

function latestLifecycleByItem(turn: V2TurnView): Map<string, V2TurnView["lifecycle"][number]> {
  const lifecycleByItem = new Map<string, V2TurnView["lifecycle"][number]>();
  for (const lifecycle of turn.lifecycle) lifecycleByItem.set(lifecycle.item.id, lifecycle);
  return lifecycleByItem;
}
