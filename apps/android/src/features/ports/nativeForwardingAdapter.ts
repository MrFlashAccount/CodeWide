/** V1 nativeForwardingAdapter owner, extracted without changing interaction or resource lifetime. */
import {
  createNativePortForwardId,
  nativePortForwardingStore,
  type NativePortForwardingSnapshot,
} from "../../data/native-port-forwarding-store";
import type { PortForwardingManagerProps } from "./portForwardingContract";

function nativePortForwardingManagerProps(
  connectionId: string,
  serverName: string,
  snapshot: NativePortForwardingSnapshot,
  onOpen: (title: string, url: string) => void,
): PortForwardingManagerProps {
  const profiles = snapshot.profiles;
  return {
    serverName,
    profiles,
    discoveredPorts: snapshot.discoveredPorts,
    discoveryStatus: snapshot.discoveryStatus,
    discoveryError: snapshot.discoveryError,
    onOpen: (profile) => {
      if (profile.status === "live" && profile.previewUrl !== null)
        onOpen(profile.label, profile.previewUrl);
    },
    onSelectPort: async (candidate) => {
      await nativePortForwardingStore.upsert({
        connectionId,
        profileId: createNativePortForwardId(),
        label: candidate.name,
        remotePort: candidate.port,
        preferredLocalPort: null,
        startImmediately: true,
        serviceKey: candidate.forwardingKey,
        preference: "included",
      });
    },
    onExcludePort: async (candidate) => {
      await nativePortForwardingStore.upsert({
        connectionId,
        profileId: `excluded-${candidate.forwardingKey.slice(0, 40)}`,
        label: candidate.name,
        remotePort: candidate.port,
        preferredLocalPort: null,
        startImmediately: false,
        serviceKey: candidate.forwardingKey,
        preference: "excluded",
      });
    },
    onAdd: async (input) => {
      await nativePortForwardingStore.upsert({
        connectionId,
        profileId: createNativePortForwardId(),
        label: input.label,
        remotePort: input.remotePort,
        preferredLocalPort: input.preferredLocalPort,
        startImmediately: input.startImmediately,
        serviceKey: null,
        preference: "included",
      });
    },
    onEdit: async (profileId, input) => {
      const existing = profiles.find((profile) => profile.id === profileId);
      await nativePortForwardingStore.upsert({
        connectionId,
        profileId,
        label: input.label,
        remotePort: input.remotePort,
        preferredLocalPort: input.preferredLocalPort,
        startImmediately: input.startImmediately,
        serviceKey: existing?.serviceKey ?? null,
        preference:
          existing?.preference === "excluded" ? "included" : (existing?.preference ?? "included"),
      });
    },
    onStart: async (profileId) => {
      const profile = profiles.find((candidate) => candidate.id === profileId);
      if (profile?.preference !== "excluded") {
        await nativePortForwardingStore.start(connectionId, profileId);
        return;
      }
      await nativePortForwardingStore.setPreference({
        connectionId,
        profileId,
        label: profile.label,
        remotePort: profile.remotePort,
        preferredLocalPort: profile.preferredLocalPort,
        serviceKey: profile.serviceKey,
        preference: "included",
        startImmediately: true,
      });
    },
    onStop: async (profileId) => {
      const profile = profiles.find((candidate) => candidate.id === profileId);
      if (profile === undefined || profile.serviceKey === null) {
        await nativePortForwardingStore.stop(connectionId, profileId);
        return;
      }
      await nativePortForwardingStore.setPreference({
        connectionId,
        profileId,
        label: profile.label,
        remotePort: profile.remotePort,
        preferredLocalPort: profile.preferredLocalPort,
        serviceKey: profile.serviceKey,
        preference: "excluded",
        startImmediately: false,
      });
    },
    onReconnect: async (profileId) =>
      await nativePortForwardingStore.reconnect(connectionId, profileId),
    onRemove: async (profileId) => await nativePortForwardingStore.remove(connectionId, profileId),
    onSetPreference: async (profileId, preference) => {
      const profile = profiles.find((candidate) => candidate.id === profileId);
      if (profile === undefined) throw new Error("Port forward not found");
      const candidate = snapshot.discoveredPorts.find(
        (value) => value.forwardingKey === profile.serviceKey,
      );
      await nativePortForwardingStore.setPreference({
        connectionId,
        profileId,
        label: profile.label,
        remotePort: candidate?.port ?? profile.remotePort,
        preferredLocalPort: profile.preferredLocalPort,
        serviceKey: profile.serviceKey,
        preference,
        startImmediately:
          preference === "included" ||
          (preference === "automatic" && candidate?.defaultForwardingEnabled === true),
      });
    },
  };
}

import { useNativePortForwarding } from "../../data/native-port-forwarding-store";

/** Subscribe to the retained native store without creating a chat-owned forward session. */
export function useNativeForwardingAdapter(
  connectionId: string | null,
  serverName: string,
  onOpen: ((title: string, url: string) => void) | undefined,
) {
  const snapshot = useNativePortForwarding(connectionId);
  return connectionId === null || onOpen === undefined
    ? undefined
    : nativePortForwardingManagerProps(connectionId, serverName, snapshot, onOpen);
}
