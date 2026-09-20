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
  openBrowser: (title: string, url: string) => void,
): PortForwardingManagerProps {
  const profiles = snapshot.profiles;
  return {
    discoveredPorts: snapshot.discoveredPorts,
    discoveryError: snapshot.discoveryError,
    discoveryStatus: snapshot.discoveryStatus,
    onAdd: async (input) => {
      await nativePortForwardingStore.upsert({
        connectionId,
        label: input.label,
        preference: "included",
        preferredLocalPort: input.preferredLocalPort,
        profileId: createNativePortForwardId(),
        remotePort: input.remotePort,
        serviceKey: null,
        startImmediately: input.startImmediately,
      });
    },
    onEdit: async (profileId, input) => {
      const existing = profiles.find((profile) => profile.id === profileId);
      await nativePortForwardingStore.upsert({
        connectionId,
        label: input.label,
        preference:
          existing?.preference === "excluded" ? "included" : (existing?.preference ?? "included"),
        preferredLocalPort: input.preferredLocalPort,
        profileId,
        remotePort: input.remotePort,
        serviceKey: existing?.serviceKey ?? null,
        startImmediately: input.startImmediately,
      });
    },
    onExcludePort: async (candidate) => {
      await nativePortForwardingStore.upsert({
        connectionId,
        label: candidate.name,
        preference: "excluded",
        preferredLocalPort: null,
        profileId: `excluded-${candidate.forwardingKey.slice(0, 40)}`,
        remotePort: candidate.port,
        serviceKey: candidate.forwardingKey,
        startImmediately: false,
      });
    },
    onOpenBrowser: openBrowser,
    onReconnect: async (profileId) => {
      await nativePortForwardingStore.reconnect(connectionId, profileId);
    },
    onRemove: async (profileId) => {
      await nativePortForwardingStore.remove(connectionId, profileId);
    },
    onSelectPort: async (candidate) => {
      await nativePortForwardingStore.upsert({
        connectionId,
        label: candidate.name,
        preference: "included",
        preferredLocalPort: null,
        profileId: createNativePortForwardId(),
        remotePort: candidate.port,
        serviceKey: candidate.forwardingKey,
        startImmediately: true,
      });
    },
    onSetPreference: async (profileId, preference) => {
      const profile = profiles.find((candidate) => candidate.id === profileId);
      if (profile === undefined) {
        throw new Error("Port forward not found");
      }
      const candidate = snapshot.discoveredPorts.find(
        (value) => value.forwardingKey === profile.serviceKey,
      );
      await nativePortForwardingStore.setPreference({
        connectionId,
        label: profile.label,
        preference,
        preferredLocalPort: profile.preferredLocalPort,
        profileId,
        remotePort: candidate?.port ?? profile.remotePort,
        serviceKey: profile.serviceKey,
        startImmediately:
          preference === "included" ||
          (preference === "automatic" && candidate?.defaultForwardingEnabled === true),
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
        label: profile.label,
        preference: "included",
        preferredLocalPort: profile.preferredLocalPort,
        profileId,
        remotePort: profile.remotePort,
        serviceKey: profile.serviceKey,
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
        label: profile.label,
        preference: "excluded",
        preferredLocalPort: profile.preferredLocalPort,
        profileId,
        remotePort: profile.remotePort,
        serviceKey: profile.serviceKey,
        startImmediately: false,
      });
    },
    profiles,
    serverName,
  };
}

import { useNativePortForwarding } from "../../data/native-port-forwarding-store";

/** Subscribe to the retained native store without creating a chat-owned forward session. */
export function useNativeForwardingAdapter(
  connectionId: string | null,
  serverName: string,
  openBrowser: ((title: string, url: string) => void) | undefined,
) {
  const snapshot = useNativePortForwarding(connectionId);
  return connectionId === null || openBrowser === undefined
    ? undefined
    : nativePortForwardingManagerProps(connectionId, serverName, snapshot, openBrowser);
}
