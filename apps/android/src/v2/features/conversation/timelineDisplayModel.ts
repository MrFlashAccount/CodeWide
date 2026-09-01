import type { V2Item, V2ThreadWindow } from "@codewide/sync-client/v2";

import type {
  TimelineDisplayActivity,
  TimelineDisplayTurn,
} from "../../../presentation/conversation/TimelineView";

export function timelineDisplayModel(window: V2ThreadWindow | null): TimelineDisplayTurn[] {
  return (window?.turns ?? []).map((turn) => {
    const activities = turn.items.flatMap(activityDisplayModel);
    return {
      activityCount: turn.activity?.count ?? activities.length,
      activities,
      assistantText: turn.items.flatMap((item) =>
        item.kind === "assistantText" ? [item.text] : [],
      ),
      completedAt: turn.completedAt,
      createdAt: turn.createdAt,
      durationMs: turn.durationMs,
      id: turn.id,
      lifecycle: [],
      state: turn.state,
      usage: turn.usage,
      userText: turn.items.flatMap((item) => (item.kind === "userText" ? [item.text] : [])),
    };
  });
}

function activityDisplayModel(item: V2Item): TimelineDisplayActivity[] {
  if (item.kind === "userText" || item.kind === "assistantText") return [];
  if (item.kind === "reasoning") {
    return [{ detail: item.summary, id: item.id, label: "Thinking" }];
  }
  if (item.kind === "command") {
    return [
      {
        detail: `$ ${item.command}\n${item.outputPreview}`,
        id: item.id,
        label: "Command",
        state: item.status,
      },
    ];
  }
  if (item.kind === "fileChange") {
    return [
      {
        detail: `${item.change}: ${item.path}`,
        id: item.id,
        label: "Changes",
        state: item.status,
      },
    ];
  }
  if (item.kind === "tool") {
    return [{ detail: item.summary, id: item.id, label: item.name, state: item.status }];
  }
  if (item.kind === "plan") {
    return [
      {
        detail: item.steps.map((step) => `${step.status}: ${step.text}`).join("\n"),
        id: item.id,
        label: "Plan",
      },
    ];
  }
  if (item.kind === "attachment") {
    return [{ detail: item.attachment.name, id: item.id, label: "Attachment" }];
  }
  return [];
}
