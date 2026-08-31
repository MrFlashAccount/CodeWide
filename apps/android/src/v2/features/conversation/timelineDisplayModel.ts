import type { V2ThreadWindow } from "@codewide/sync-client/v2";

import type { TimelineDisplayRow } from "../../../presentation/conversation/TimelineView";

export function timelineDisplayModel(window: V2ThreadWindow | null): TimelineDisplayRow[] {
  return (window?.turns ?? []).flatMap((turn) => {
    const items: TimelineDisplayRow[] = turn.items.map((item) => {
      if (item.kind === "userText") {
        return { id: item.id, kind: "user", text: item.text };
      }
      if (item.kind === "assistantText") {
        return { id: item.id, kind: "assistant", text: item.text };
      }
      if (item.kind === "reasoning") {
        return { id: item.id, kind: "lifecycle", label: item.summary };
      }
      if (item.kind === "command") {
        return {
          detail: `$ ${item.command}\n${item.outputPreview}`,
          id: item.id,
          kind: "activity",
          label: "Command",
          state: item.status,
        };
      }
      if (item.kind === "fileChange") {
        return {
          detail: `${item.change}: ${item.path}`,
          id: item.id,
          kind: "activity",
          label: "Changes",
        };
      }
      if (item.kind === "tool") {
        return {
          detail: item.summary,
          id: item.id,
          kind: "activity",
          label: item.name,
          state: item.status,
        };
      }
      if (item.kind === "plan") {
        return {
          detail: item.steps.map((step) => `${step.status}: ${step.text}`).join("\n"),
          id: item.id,
          kind: "activity",
          label: "Plan",
        };
      }
      if (item.kind === "attachment") {
        return {
          detail: item.attachment.name,
          id: item.id,
          kind: "activity",
          label: "Attachment",
        };
      }
      return { id: item.id, kind: "lifecycle", label: item.text };
    });
    items.push({ id: `${turn.id}:status`, kind: "status", state: turn.state });
    return items;
  });
}
