import type { V2ThreadWindow } from "@codewide/sync-client/v2";

export type TimelineDisplayRow = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};

export function timelineDisplayModel(window: V2ThreadWindow | null): TimelineDisplayRow[] {
  return (window?.turns ?? []).flatMap((turn) =>
    turn.items.map((item) => {
      if (item.kind === "userText") {
        return { id: item.id, role: "user" as const, text: item.text };
      }
      if (item.kind === "assistantText") {
        return { id: item.id, role: "assistant" as const, text: item.text };
      }
      if (item.kind === "reasoning") {
        return { id: item.id, role: "system" as const, text: item.summary };
      }
      if (item.kind === "command") {
        return {
          id: item.id,
          role: "system" as const,
          text: `$ ${item.command}\n${item.outputPreview}`,
        };
      }
      if (item.kind === "fileChange") {
        return { id: item.id, role: "system" as const, text: `${item.change}: ${item.path}` };
      }
      if (item.kind === "tool") {
        return { id: item.id, role: "system" as const, text: `${item.name}: ${item.summary}` };
      }
      if (item.kind === "plan") {
        return {
          id: item.id,
          role: "system" as const,
          text: item.steps.map((step) => `${step.status}: ${step.text}`).join("\n"),
        };
      }
      if (item.kind === "attachment") {
        return {
          id: item.id,
          role: "system" as const,
          text: `Attachment: ${item.attachment.name}`,
        };
      }
      return { id: item.id, role: "system" as const, text: item.text };
    }),
  );
}
