import {
  parseActivityFootprint,
  type ActivityMetrics,
  type ActivityFootprint,
} from "@codewide/sync-client";

const COMMAND_ACTIVITY_TITLE_CHARS = 120;

export function commandActivityInput(raw: Record<string, unknown>, fallbackTitle: string): string {
  const command = raw.command;
  return typeof command === "string" && command !== "" ? command : fallbackTitle;
}

export function commandActivityTitle(command: string): string {
  const singleLine = command.replaceAll(/\s+/gu, " ").trim();
  if (singleLine === "") {
    return "Command";
  }
  if (singleLine.length <= COMMAND_ACTIVITY_TITLE_CHARS) {
    return singleLine;
  }
  return `${singleLine.slice(0, COMMAND_ACTIVITY_TITLE_CHARS - 1)}…`;
}

/** Reads server attribution only; absent metadata is unknown, never a text estimate. */
export function commandOutputFootprint(
  raw: Record<string, unknown>,
  metrics: ActivityMetrics | null = null,
): ActivityFootprint | null {
  const id = raw.id;
  const live = typeof id === "string" ? metrics?.commands[id] : null;
  return live ?? parseActivityFootprint(raw.codewideOutputFootprint);
}
