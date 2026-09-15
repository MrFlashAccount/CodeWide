import type { AppListRowProps } from "../../ui/AppListRow.types";
import type {
  PortForwardingProfile,
  ServiceEntry,
  ServiceListRow,
  ServiceSegment,
} from "./portForwardingContract";
export const GROUP_HEIGHT = 36;

export const PROFILE_ERROR_HEIGHT = 52;

export function serviceRowKey(entry: ServiceListRow): string {
  if (entry.type === "group") return `group:${entry.group}`;
  return entry.type === "candidate"
    ? `candidate:${entry.candidate.forwardingKey}`
    : `profile:${entry.profile.id}`;
}

export function hasProfileError(profile: PortForwardingProfile): boolean {
  return (profile.status === "error" || profile.status === "unavailable") && profile.error !== null;
}

export function groupEntries(entries: readonly ServiceEntry[]): Array<[string, ServiceEntry[]]> {
  const groups = new Map<string, ServiceEntry[]>();
  for (const entry of entries) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  return [...groups].sort(([left], [right]) => left.localeCompare(right));
}

export function serviceEntryMatches(entry: ServiceEntry, needle: string): boolean {
  if (needle === "") return true;
  if (entry.type === "candidate") {
    const { candidate } = entry;
    return [
      candidate.name,
      candidate.group,
      candidate.details,
      candidate.kind,
      String(candidate.port),
    ].some((value) => value.toLocaleLowerCase().includes(needle));
  }
  return [entry.profile.label, entry.group, entry.kind, String(entry.profile.remotePort)].some(
    (value) => value.toLocaleLowerCase().includes(needle),
  );
}

export function serviceRowPosition(
  rows: readonly ServiceListRow[],
  index: number,
): NonNullable<AppListRowProps["position"]> {
  const current = rows[index];
  if (current === undefined || current.type === "group") return "only";
  const previous = rows[index - 1];
  const next = rows[index + 1];
  const first =
    previous === undefined || previous.type === "group" || previous.group !== current.group;
  const last = next === undefined || next.type === "group" || next.group !== current.group;
  if (first && last) return "only";
  if (first) return "first";
  return last ? "last" : "middle";
}

export function segmentTitle(segment: ServiceSegment): string {
  return segment === "active" ? "Active" : segment === "available" ? "Available" : "Excluded";
}

export function emptySegmentTitle(segment: ServiceSegment): string {
  return segment === "active"
    ? "No active ports"
    : segment === "available"
      ? "No available ports"
      : "No excluded ports";
}

export function emptySegmentSubtitle(segment: ServiceSegment): string {
  return segment === "active"
    ? "Include a discovered service or add a port manually"
    : segment === "available"
      ? "Every discovered service is active or excluded"
      : "Services you exclude will appear here";
}
