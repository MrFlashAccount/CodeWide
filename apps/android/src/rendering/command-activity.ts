import { projectedOutputFootprint, sumOutputFootprints, type OutputFootprintProjection, type TurnUsageProjection } from "@codewide/sync-client";

const COMMAND_ACTIVITY_TITLE_CHARS = 120;
const APPROX_BYTES_PER_TOKEN = 4;

export function commandActivityInput(raw: Record<string, unknown>, fallbackTitle: string): string {
  const command = raw.command;
  return typeof command === "string" && command !== "" ? command : fallbackTitle;
}

export function commandActivityTitle(command: string): string {
  const singleLine = command.replace(/\s+/gu, " ").trim();
  if (singleLine === "") return "Command";
  if (singleLine.length <= COMMAND_ACTIVITY_TITLE_CHARS) return singleLine;
  return `${singleLine.slice(0, COMMAND_ACTIVITY_TITLE_CHARS - 1)}…`;
}

export function commandOutputFootprint(raw: Record<string, unknown>, visibleOutput = ""): OutputFootprintProjection | null {
  const projected = projectedOutputFootprint(raw.codewideOutputFootprint);
  if (projected !== null) return projected;
  const bytes = utf8ByteLength(visibleOutput);
  return bytes === 0
    ? null
    : {
        version: 1,
        basis: "approxBytesPerToken",
        bytes,
        estimatedTokens: Math.ceil(bytes / APPROX_BYTES_PER_TOKEN),
      };
}

export function activityOutputFootprint(items: readonly { raw: Record<string, unknown>; visibleOutput?: string | null }[]): OutputFootprintProjection | null {
  return sumOutputFootprints(items.map(({ raw, visibleOutput }) => commandOutputFootprint(raw, visibleOutput ?? "")));
}

export function estimatedOutputInputCostUsd(footprint: OutputFootprintProjection | null, usage: TurnUsageProjection | null): number | null {
  const inputPrice = usage?.turn.cost?.price.input;
  if (footprint === null || inputPrice === undefined || !Number.isFinite(inputPrice)) return null;
  return footprint.estimatedTokens * inputPrice / 1_000_000;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
