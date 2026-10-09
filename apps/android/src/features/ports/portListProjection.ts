import type {
  PortForwardingManagerProps,
  ServiceEntry,
  ServiceListRow,
  ServiceSegment,
} from "./portForwardingContract";
import { groupEntries, serviceEntryMatches } from "./portForwardingList";
import { projectPortProfileEntries } from "./portProfileProjection";

export function projectPortList(
  props: Pick<PortForwardingManagerProps, "profiles" | "discoveredPorts">,
  segment: ServiceSegment,
  query: string,
) {
  const currentProfileEntries = projectPortProfileEntries(props.discoveredPorts, props.profiles);
  const currentProfiles = currentProfileEntries.map((entry) => entry.profile);
  const configuredKeys = new Set(
    currentProfiles
      .map((profile) => profile.serviceKey)
      .filter((key): key is string => key !== null),
  );
  const configuredPorts = new Set(currentProfiles.map((profile) => profile.remotePort));
  const availableCandidates = props.discoveredPorts.filter(
    (candidate) =>
      !candidate.defaultForwardingEnabled &&
      !configuredKeys.has(candidate.forwardingKey) &&
      !configuredPorts.has(candidate.port),
  );
  const activeEntries = currentProfileEntries.filter(
    ({ profile }) => profile.preference !== "excluded" && profile.status !== "unavailable",
  );
  const excludedEntries = currentProfileEntries.filter(
    ({ profile }) => profile.preference === "excluded",
  );
  const entries: ServiceEntry[] =
    segment === "available"
      ? availableCandidates.map((candidate) => ({
          candidate,
          group: candidate.group,
          type: "candidate",
        }))
      : segment === "active"
        ? activeEntries
        : excludedEntries;
  const needle = query.trim().toLocaleLowerCase();
  const groups = groupEntries(entries.filter((entry) => serviceEntryMatches(entry, needle)));
  const rows: ServiceListRow[] = [];
  for (const [group, members] of groups) {
    rows.push({ group, type: "group" });
    for (const member of members) {
      rows.push(member);
    }
  }
  const counts: Record<ServiceSegment, number> = {
    active: activeEntries.length,
    available: availableCandidates.length,
    excluded: excludedEntries.length,
  };
  return { counts, groups, rows };
}
