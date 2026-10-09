import type { NativePortForwardingSnapshot } from "../../data/native-port-forwarding-store";
import type { NativePortForwardProfile } from "../../native/native-transport";
import type { ProfileServiceEntry } from "./portForwardingContract";
import { groupEntries } from "./portForwardingList";
import { projectPortProfileEntries } from "./portProfileProjection";

/** Keeps the inventory's categories and service kinds while admitting only live shortcuts. */
export function projectBrowserHomePorts(
  snapshot: Pick<NativePortForwardingSnapshot, "discoveredPorts" | "profiles">,
  connectionId: string | null,
): {
  readonly group: string;
  readonly services: readonly ProfileServiceEntry<NativePortForwardProfile>[];
}[] {
  const liveProfiles = snapshot.profiles.filter((profile) => isLiveShortcut(profile, connectionId));
  const entries = projectPortProfileEntries(snapshot.discoveredPorts, liveProfiles);
  return groupEntries(entries).map(([group, services]) => ({ group, services }));
}

function isLiveShortcut(profile: NativePortForwardProfile, connectionId: string | null): boolean {
  return (
    profile.connectionId === connectionId &&
    profile.status === "live" &&
    profile.previewUrl !== null
  );
}
