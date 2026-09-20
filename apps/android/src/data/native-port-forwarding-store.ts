import { useSyncExternalStore } from "react";

import {
  discoverNativePorts,
  listNativePortForwards,
  removeNativePortForward,
  startNativePortForward,
  stopNativePortForward,
  subscribeNativePortForwards,
  upsertNativePortForward,
  type NativePortForwardProfile,
  type NativeDiscoveredPort,
  type NativePortForwardingPreference,
} from "../native/native-transport";

type Listener = () => void;

const EMPTY_PORT_FORWARDING_SNAPSHOT: NativePortForwardingSnapshot = {
  discoveredPorts: [],
  discoveryError: null,
  discoveryStatus: "idle",
  profiles: [],
  profilesStatus: "ready",
};
const subscribeToNothing =
  (_listener: Listener): (() => void) =>
  () =>
    undefined;
const readEmptyPortForwardingSnapshot = (): NativePortForwardingSnapshot =>
  EMPTY_PORT_FORWARDING_SNAPSHOT;

class PortForwardScope {
  readonly connectionId: string;
  readonly #listeners = new Set<Listener>();
  #snapshot: NativePortForwardingSnapshot = {
    discoveredPorts: [],
    discoveryError: null,
    discoveryStatus: "idle",
    profiles: [],
    profilesStatus: "loading",
  };
  #loaded = false;
  #loading: Promise<void> | null = null;
  #discoveryLoading: Promise<void> | null = null;
  #discoveredAt = 0;
  #discoveryDirty = false;

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    this.#loadInBackground();
    if (Date.now() - this.#discoveredAt > DISCOVERY_STALE_MS) {
      this.#refreshDiscoveryInBackground();
    }
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): NativePortForwardingSnapshot => this.#snapshot;

  inventoryUpdated(): void {
    this.#discoveryDirty = this.#discoveryLoading !== null;
    this.#refreshDiscoveryInBackground();
  }

  inventoryFailed(): void {
    this.#replace({
      ...this.#snapshot,
      discoveryError: "Could not update server ports",
      discoveryStatus: "error",
    });
  }

  async load(force = false): Promise<void> {
    if (this.connectionId === "" || (this.#loaded && !force)) {
      return;
    }
    if (this.#loading !== null) {
      await this.#loading;
      return;
    }
    this.#replace({ ...this.#snapshot, profilesStatus: "loading" });
    this.#loading = listNativePortForwards(this.connectionId)
      .then((profiles) => {
        this.#loaded = true;
        this.#replaceProfiles(profiles, "ready");
      })
      .catch((error: unknown) => {
        this.#replace({ ...this.#snapshot, profilesStatus: "error" });
        throw error;
      })
      .finally(() => {
        this.#loading = null;
      });
    await this.#loading;
  }

  async refreshDiscovery(): Promise<void> {
    if (this.connectionId === "") {
      return;
    }
    if (this.#discoveryLoading !== null) {
      await this.#discoveryLoading;
      return;
    }
    this.#replace({ ...this.#snapshot, discoveryError: null, discoveryStatus: "loading" });
    this.#discoveryLoading = discoverNativePorts(this.connectionId)
      .then(async ({ ports, scannedAt }) => {
        this.#discoveredAt = scannedAt;
        // The native push worker reconciles before notifying us. Reload
        // current forwards so missed bridge events cannot retain dead profiles.
        const profiles = await listNativePortForwards(this.connectionId);
        this.#loaded = true;
        this.#replace({
          ...this.#snapshot,
          discoveredPorts: ports,
          discoveryError: null,
          discoveryStatus: scannedAt === 0 ? "loading" : "ready",
          profiles,
          profilesStatus: "ready",
        });
      })
      .catch((error: unknown) => {
        this.#replace({
          ...this.#snapshot,
          discoveryError: error instanceof Error ? error.message : "Could not discover open ports",
          discoveryStatus: "error",
        });
      })
      .finally(() => {
        this.#discoveryLoading = null;
        if (this.#discoveryDirty) {
          this.#discoveryDirty = false;
          this.#refreshDiscoveryInBackground();
        }
      });
    await this.#discoveryLoading;
  }

  #loadInBackground(): void {
    this.load().catch((error: unknown) => {
      this.#replace({
        ...this.#snapshot,
        discoveryError: error instanceof Error ? error.message : "Could not load forwarded ports",
      });
    });
  }

  #refreshDiscoveryInBackground(): void {
    this.refreshDiscovery().catch((error: unknown) => {
      this.#replace({
        ...this.#snapshot,
        discoveryError: error instanceof Error ? error.message : "Could not discover open ports",
        discoveryStatus: "error",
      });
    });
  }

  async waitUntilLive(profileId: string, timeoutMs = 10_000): Promise<NativePortForwardProfile> {
    const ready = (): NativePortForwardProfile | null => {
      const profile = this.#snapshot.profiles.find((candidate) => candidate.id === profileId);
      if (profile?.status === "error" || profile?.status === "unavailable") {
        throw new Error(profile.error ?? "Remote port is unavailable");
      }
      return profile?.status === "live" && profile.localPort !== null ? profile : null;
    };
    const current = ready();
    if (current !== null) {
      return current;
    }
    return new Promise<NativePortForwardProfile>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.#listeners.delete(check);
        action();
      };
      const check = () => {
        try {
          const profile = ready();
          if (profile !== null) {
            finish(() => {
              resolve(profile);
            });
          }
        } catch (error) {
          finish(() => {
            reject(error instanceof Error ? error : new Error("Remote port is unavailable"));
          });
        }
      };
      const timer = setTimeout(() => {
        finish(() => {
          reject(new Error("The phone port did not become ready in time"));
        });
      }, timeoutMs);
      this.#listeners.add(check);
      check();
    });
  }

  apply(profile: NativePortForwardProfile): void {
    if (profile.connectionId !== this.connectionId) {
      return;
    }
    const index = this.#snapshot.profiles.findIndex((candidate) => candidate.id === profile.id);
    if (index < 0) {
      this.#replaceProfiles([profile, ...this.#snapshot.profiles], this.#snapshot.profilesStatus);
    } else {
      this.#replaceProfiles(
        this.#snapshot.profiles.map((candidate, candidateIndex) =>
          candidateIndex === index ? profile : candidate,
        ),
        this.#snapshot.profilesStatus,
      );
    }
  }

  applyStartResult(profile: NativePortForwardProfile): NativePortForwardProfile {
    const current = this.#snapshot.profiles.find((candidate) => candidate.id === profile.id);
    // Native binding happens off-thread. Its live event can beat the bridge
    // Promise carrying the older connecting projection back to JavaScript.
    // Never let that stale method result overwrite the authoritative event.
    if (
      profile.status === "connecting" &&
      current !== undefined &&
      ["live", "unavailable", "error"].includes(current.status) &&
      current.updatedAt >= profile.updatedAt
    ) {
      return current;
    }
    this.apply(profile);
    return profile;
  }

  remove(profileId: string): void {
    if (!this.#snapshot.profiles.some((profile) => profile.id === profileId)) {
      return;
    }
    this.#replaceProfiles(
      this.#snapshot.profiles.filter((profile) => profile.id !== profileId),
      this.#snapshot.profilesStatus,
    );
  }

  #replaceProfiles(
    profiles: readonly NativePortForwardProfile[],
    profilesStatus: NativePortForwardingSnapshot["profilesStatus"],
  ): void {
    this.#replace({
      ...this.#snapshot,
      profiles: [...profiles].sort((left, right) => {
        const enabledOrder = Number(right.enabled) - Number(left.enabled);
        return enabledOrder !== 0 ? enabledOrder : right.updatedAt - left.updatedAt;
      }),
      profilesStatus,
    });
  }

  #replace(snapshot: NativePortForwardingSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

export type NativePortForwardingSnapshot = {
  discoveredPorts: readonly NativeDiscoveredPort[];
  discoveryError: string | null;
  discoveryStatus: "idle" | "loading" | "ready" | "error";
  profiles: readonly NativePortForwardProfile[];
  profilesStatus: "loading" | "ready" | "error";
};

const DISCOVERY_STALE_MS = 60_000;

class NativePortForwardingStore {
  readonly #scopes = new Map<string, PortForwardScope>();
  readonly #starting = new Map<string, Promise<NativePortForwardProfile>>();

  constructor() {
    subscribeNativePortForwards((event) => {
      if (event.type === "profile") {
        this.scope(event.profile.connectionId).apply(event.profile);
      } else if (event.type === "removed") {
        for (const scope of this.#scopes.values()) {
          scope.remove(event.id);
        }
      } else if (event.type === "inventory") {
        this.scope(event.connectionId).inventoryUpdated();
      } else {
        this.scope(event.connectionId).inventoryFailed();
      }
    });
  }

  scope(connectionId: string): PortForwardScope {
    let scope = this.#scopes.get(connectionId);
    if (scope === undefined) {
      scope = new PortForwardScope(connectionId);
      this.#scopes.set(connectionId, scope);
    }
    return scope;
  }

  async upsert(input: {
    connectionId: string;
    label: string;
    preference?: NativePortForwardingPreference;
    preferredLocalPort: number | null;
    profileId: string;
    remotePort: number;
    serviceKey?: string | null;
    startImmediately: boolean;
  }): Promise<NativePortForwardProfile> {
    const profile = await upsertNativePortForward({
      ...input,
      preference: input.preference ?? "included",
      serviceKey: input.serviceKey ?? null,
    });
    this.scope(input.connectionId).apply(profile);
    const next = input.startImmediately
      ? await startNativePortForward(profile.id)
      : await stopNativePortForward(profile.id);
    this.scope(input.connectionId).apply(next);
    return next;
  }

  async start(connectionId: string, profileId: string): Promise<NativePortForwardProfile> {
    const profile = await startNativePortForward(profileId);
    return this.scope(connectionId).applyStartResult(profile);
  }

  async stop(connectionId: string, profileId: string): Promise<void> {
    this.scope(connectionId).apply(await stopNativePortForward(profileId));
  }

  async reconnect(connectionId: string, profileId: string): Promise<void> {
    const scope = this.scope(connectionId);
    const profile = scope.getSnapshot().profiles.find((candidate) => candidate.id === profileId);
    if (profile === undefined) {
      throw new Error("Port forward not found");
    }
    scope.apply(await stopNativePortForward(profileId));
    // Reconnect must not turn an automatic forward into a persistent inclusion.
    const restored = await upsertNativePortForward({
      connectionId,
      label: profile.label,
      preference: profile.preference === "excluded" ? "included" : profile.preference,
      preferredLocalPort: profile.preferredLocalPort,
      profileId,
      remotePort: profile.remotePort,
      serviceKey: profile.serviceKey,
    });
    scope.apply(restored);
    scope.applyStartResult(await startNativePortForward(restored.id));
  }

  async remove(connectionId: string, profileId: string): Promise<void> {
    await removeNativePortForward(profileId);
    await this.scope(connectionId).load(true);
  }

  async refreshDiscovery(connectionId: string): Promise<void> {
    await this.scope(connectionId).refreshDiscovery();
  }

  async setPreference(input: {
    connectionId: string;
    label: string;
    preference: NativePortForwardingPreference;
    preferredLocalPort: number | null;
    profileId: string;
    remotePort: number;
    serviceKey: string | null;
    startImmediately: boolean;
  }): Promise<NativePortForwardProfile> {
    return this.upsert(input);
  }

  async ensureStarted(input: {
    connectionId: string;
    label: string;
    remotePort: number;
  }): Promise<NativePortForwardProfile> {
    const key = `${input.connectionId}\u0000${String(input.remotePort)}`;
    const pending = this.#starting.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const starting = this.#ensureStarted(input).finally(() => {
      this.#starting.delete(key);
    });
    this.#starting.set(key, starting);
    return starting;
  }

  async #ensureStarted(input: {
    connectionId: string;
    label: string;
    remotePort: number;
  }): Promise<NativePortForwardProfile> {
    const scope = this.scope(input.connectionId);
    await scope.refreshDiscovery();
    if (!scope.getSnapshot().discoveredPorts.some((port) => port.port === input.remotePort)) {
      throw new Error("Port is not present in the current inventory");
    }
    const existing = scope
      .getSnapshot()
      .profiles.filter((profile) => profile.remotePort === input.remotePort)
      .sort((left, right) => {
        const statusOrder = Number(right.status === "live") - Number(left.status === "live");
        return statusOrder !== 0 ? statusOrder : right.updatedAt - left.updatedAt;
      })[0];
    if (existing?.status === "live" && existing.localPort !== null) {
      return existing;
    }
    if (existing?.status === "connecting") {
      return scope.waitUntilLive(existing.id);
    }

    let profileId = existing?.id ?? createNativePortForwardId();
    if (existing === undefined) {
      const saved = await upsertNativePortForward({
        connectionId: input.connectionId,
        label: input.label,
        preference: "included",
        preferredLocalPort: null,
        profileId,
        remotePort: input.remotePort,
        serviceKey: null,
      });
      scope.apply(saved);
      profileId = saved.id;
    }
    const started = await startNativePortForward(profileId);
    const projected = scope.applyStartResult(started);
    if (projected.status === "error") {
      throw new Error(projected.error ?? "Could not open phone port");
    }
    if (projected.status === "live" && projected.localPort !== null) {
      return projected;
    }
    return scope.waitUntilLive(profileId);
  }
}

export const nativePortForwardingStore = new NativePortForwardingStore();

export function useNativePortForwarding(connectionId: string | null): NativePortForwardingSnapshot {
  const scope = connectionId === null ? null : nativePortForwardingStore.scope(connectionId);
  return useSyncExternalStore(
    scope?.subscribe ?? subscribeToNothing,
    scope?.getSnapshot ?? readEmptyPortForwardingSnapshot,
    scope?.getSnapshot ?? readEmptyPortForwardingSnapshot,
  );
}

export function createNativePortForwardId(): string {
  return `forward-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
