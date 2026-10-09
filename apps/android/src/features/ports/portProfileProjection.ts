import type {
  PortForwardingCandidate,
  PortForwardingProfile,
  ProfileServiceEntry,
} from "./portForwardingContract";

/** Matches configured profiles to the current discovery inventory for every Ports surface. */
export function projectPortProfileEntries<Profile extends PortForwardingProfile>(
  discoveredPorts: readonly PortForwardingCandidate[],
  profiles: readonly Profile[],
): ProfileServiceEntry<Profile>[] {
  return profiles.flatMap((profile) => {
    const candidate = discoveredPorts.find(
      (value) =>
        value.forwardingKey === profile.serviceKey ||
        (profile.serviceKey === null && value.port === profile.remotePort),
    );
    return candidate === undefined
      ? []
      : [
          {
            group: candidate.group,
            kind: candidate.kind,
            profile,
            type: "profile" as const,
          },
        ];
  });
}
