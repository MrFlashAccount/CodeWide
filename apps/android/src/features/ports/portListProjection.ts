import type {
  PortForwardingManagerProps,
  ServiceEntry,
  ServiceListRow,
  ServiceSegment,
} from "./portForwardingContract";
import { groupEntries, serviceEntryMatches } from "./portForwardingList";

export function projectPortList(
  props: Pick<PortForwardingManagerProps, "profiles" | "discoveredPorts">,
  segment: ServiceSegment,
  query: string,
) {
  const currentProfiles = props.profiles.filter((profile) =>
    props.discoveredPorts.some(
      (candidate) =>
        profile.serviceKey === candidate.forwardingKey ||
        (profile.serviceKey === null && profile.remotePort === candidate.port),
    ),
  );
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
  const activeProfiles = currentProfiles.filter((profile) => profile.preference !== "excluded");
  const excludedProfiles = currentProfiles.filter((profile) => profile.preference === "excluded");
  const entries: ServiceEntry[] =
    segment === "available"
      ? availableCandidates.map((candidate) => ({
          type: "candidate",
          group: candidate.group,
          candidate,
        }))
      : (segment === "active" ? activeProfiles : excludedProfiles).flatMap((profile) => {
          const candidate = props.discoveredPorts.find(
            (value) =>
              value.forwardingKey === profile.serviceKey ||
              (profile.serviceKey === null && value.port === profile.remotePort),
          );
          if (candidate === undefined) return [];
          return [
            {
              type: "profile" as const,
              group: candidate.group,
              profile,
              kind: candidate.kind,
            },
          ];
        });
  const needle = query.trim().toLocaleLowerCase();
  const groups = groupEntries(entries.filter((entry) => serviceEntryMatches(entry, needle)));
  const rows: ServiceListRow[] = [];
  for (const [group, members] of groups) {
    rows.push({ type: "group", group });
    for (const member of members) rows.push(member);
  }
  const counts: Record<ServiceSegment, number> = {
    active: activeProfiles.length,
    available: availableCandidates.length,
    excluded: excludedProfiles.length,
  };
  return { rows, counts, groups };
}
