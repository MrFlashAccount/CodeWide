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

const EMPTY_PORT_FORWARDING_SNAPSHOT: NativePortForwardingSnapshot = Object.freeze({
  profiles: Object.freeze([]),
  discoveredPorts: Object.freeze([]),
  discoveryStatus: "idle",
  discoveryError: null,
});
const subscribeToNothing = (_listener: Listener): (() => void) => () => undefined;
const readEmptyPortForwardingSnapshot = (): NativePortForwardingSnapshot => EMPTY_PORT_FORWARDING_SNAPSHOT;

class PortForwardScope {
  readonly connectionId: string;
  #listeners = new Set<Listener>();
  #snapshot: NativePortForwardingSnapshot = { profiles: [], discoveredPorts: [], discoveryStatus: "idle", discoveryError: null };
  #loaded = false;
  #loading: Promise<void> | null = null;
  #discoveryLoading: Promise<void> | null = null;
  #discoveredAt = 0;
  #pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(connectionId: string, private readonly onDiscovered: (ports: readonly NativeDiscoveredPort[]) => Promise<void>) {
    this.connectionId = connectionId;
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    void this.load();
    if (Date.now() - this.#discoveredAt > DISCOVERY_STALE_MS) void this.refreshDiscovery();
    this.#pollTimer ??= setInterval(() => void this.refreshDiscovery(), DISCOVERY_POLL_MS);
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0 && this.#pollTimer !== null) {
        clearInterval(this.#pollTimer);
        this.#pollTimer = null;
      }
    };
  };

  readonly getSnapshot = (): NativePortForwardingSnapshot => this.#snapshot;

  async load(force = false): Promise<void> {
    if (this.connectionId === "" || (this.#loaded && !force)) return;
    if (this.#loading !== null) return await this.#loading;
    this.#loading = listNativePortForwards(this.connectionId)
      .then((profiles) => {
        this.#loaded = true;
        this.#replaceProfiles(profiles);
      })
      .finally(() => { this.#loading = null; });
    await this.#loading;
  }

  async refreshDiscovery(): Promise<void> {
    if (this.connectionId === "") return;
    if (this.#discoveryLoading !== null) return await this.#discoveryLoading;
    this.#replace({ ...this.#snapshot, discoveryStatus: "loading", discoveryError: null });
    this.#discoveryLoading = discoverNativePorts(this.connectionId)
      .then(async ({ ports, scannedAt }) => {
        this.#discoveredAt = scannedAt;
        this.#replace({ ...this.#snapshot, discoveredPorts: ports, discoveryStatus: "ready", discoveryError: null });
        await this.onDiscovered(ports);
      })
      .catch((cause: unknown) => {
        this.#replace({
          ...this.#snapshot,
          discoveryStatus: "error",
          discoveryError: cause instanceof Error ? cause.message : "Could not discover open ports",
        });
      })
      .finally(() => { this.#discoveryLoading = null; });
    await this.#discoveryLoading;
  }

  async waitUntilLive(profileId: string, timeoutMs = 10_000): Promise<NativePortForwardProfile> {
    const ready = (): NativePortForwardProfile | null => {
      const profile = this.#snapshot.profiles.find((candidate) => candidate.id === profileId);
      if (profile?.status === "error" || profile?.status === "unavailable") throw new Error(profile.error ?? "Remote port is unavailable");
      return profile?.status === "live" && profile.localPort !== null ? profile : null;
    };
    const current = ready();
    if (current !== null) return current;
    return await new Promise<NativePortForwardProfile>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#listeners.delete(check);
        action();
      };
      const check = () => {
        try {
          const profile = ready();
          if (profile !== null) finish(() => resolve(profile));
        } catch (cause) {
          finish(() => reject(cause));
        }
      };
      const timer = setTimeout(() => {
        finish(() => reject(new Error("The phone port did not become ready in time")));
      }, timeoutMs);
      this.#listeners.add(check);
      check();
    });
  }

  apply(profile: NativePortForwardProfile): void {
    if (profile.connectionId !== this.connectionId) return;
    const index = this.#snapshot.profiles.findIndex((candidate) => candidate.id === profile.id);
    if (index < 0) this.#replaceProfiles([profile, ...this.#snapshot.profiles]);
    else this.#replaceProfiles(this.#snapshot.profiles.map((candidate, candidateIndex) => candidateIndex === index ? profile : candidate));
  }

  applyStartResult(profile: NativePortForwardProfile): NativePortForwardProfile {
    const current = this.#snapshot.profiles.find((candidate) => candidate.id === profile.id);
    // Native binding happens off-thread. Its live event can beat the bridge
    // Promise carrying the older connecting projection back to JavaScript.
    // Never let that stale method result overwrite the authoritative event.
    if (profile.status === "connecting"
      && current !== undefined
      && ["live", "unavailable", "error"].includes(current.status)
      && current.updatedAt >= profile.updatedAt) return current;
    this.apply(profile);
    return profile;
  }

  remove(profileId: string): void {
    if (!this.#snapshot.profiles.some((profile) => profile.id === profileId)) return;
    this.#replaceProfiles(this.#snapshot.profiles.filter((profile) => profile.id !== profileId));
  }

  #replaceProfiles(profiles: readonly NativePortForwardProfile[]): void {
    this.#replace({ ...this.#snapshot, profiles: [...profiles].sort((left, right) => Number(right.enabled) - Number(left.enabled) || right.updatedAt - left.updatedAt) });
  }

  #replace(snapshot: NativePortForwardingSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}

export type NativePortForwardingSnapshot = {
  profiles: readonly NativePortForwardProfile[];
  discoveredPorts: readonly NativeDiscoveredPort[];
  discoveryStatus: "idle" | "loading" | "ready" | "error";
  discoveryError: string | null;
};

const DISCOVERY_STALE_MS = 60_000;
const DISCOVERY_POLL_MS = 5_000;

class NativePortForwardingStore {
  #scopes = new Map<string, PortForwardScope>();
  #starting = new Map<string, Promise<NativePortForwardProfile>>();
  #reconciling = new Map<string, Promise<void>>();

  constructor() {
    subscribeNativePortForwards((event) => {
      if (event.type === "profile") this.scope(event.profile.connectionId).apply(event.profile);
      else for (const scope of this.#scopes.values()) scope.remove(event.id);
    });
  }

  scope(connectionId: string): PortForwardScope {
    let scope = this.#scopes.get(connectionId);
    if (scope === undefined) {
      scope = new PortForwardScope(connectionId, async (ports) => await this.#reconcileDiscovered(connectionId, ports));
      this.#scopes.set(connectionId, scope);
    }
    return scope;
  }

  async upsert(input: {
    connectionId: string;
    profileId: string;
    label: string;
    remotePort: number;
    preferredLocalPort: number | null;
    startImmediately: boolean;
    serviceKey?: string | null;
    preference?: NativePortForwardingPreference;
  }): Promise<NativePortForwardProfile> {
    const profile = await upsertNativePortForward({
      ...input,
      serviceKey: input.serviceKey ?? null,
      preference: input.preference ?? "included",
    });
    this.scope(input.connectionId).apply(profile);
    const next = input.startImmediately
      ? await startNativePortForward(input.profileId)
      : await stopNativePortForward(input.profileId);
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
    this.scope(connectionId).apply(await stopNativePortForward(profileId));
    this.scope(connectionId).apply(await startNativePortForward(profileId));
  }

  async remove(connectionId: string, profileId: string): Promise<void> {
    await removeNativePortForward(profileId);
    this.scope(connectionId).remove(profileId);
  }

  async refreshDiscovery(connectionId: string): Promise<void> {
    await this.scope(connectionId).refreshDiscovery();
  }

  async setPreference(input: {
    connectionId: string;
    profileId: string;
    label: string;
    remotePort: number;
    preferredLocalPort: number | null;
    serviceKey: string | null;
    preference: NativePortForwardingPreference;
    startImmediately: boolean;
  }): Promise<NativePortForwardProfile> {
    return await this.upsert(input);
  }

  async ensureStarted(input: {
    connectionId: string;
    remotePort: number;
    label: string;
  }): Promise<NativePortForwardProfile> {
    const key = `${input.connectionId}\u0000${input.remotePort}`;
    const pending = this.#starting.get(key);
    if (pending !== undefined) return await pending;
    const starting = this.#ensureStarted(input).finally(() => this.#starting.delete(key));
    this.#starting.set(key, starting);
    return await starting;
  }

  async #ensureStarted(input: {
    connectionId: string;
    remotePort: number;
    label: string;
  }): Promise<NativePortForwardProfile> {
    const scope = this.scope(input.connectionId);
    await scope.load();
    const existing = scope.getSnapshot().profiles
      .filter((profile) => profile.remotePort === input.remotePort)
      .sort((left, right) => Number(right.status === "live") - Number(left.status === "live") || right.updatedAt - left.updatedAt)[0];
    if (existing?.status === "live" && existing.localPort !== null) return existing;
    if (existing?.status === "connecting") return await scope.waitUntilLive(existing.id);

    const profileId = existing?.id ?? createNativePortForwardId();
    if (existing === undefined) {
      const saved = await upsertNativePortForward({
        connectionId: input.connectionId,
        profileId,
        label: input.label,
        remotePort: input.remotePort,
        preferredLocalPort: null,
        serviceKey: null,
        preference: "included",
      });
      scope.apply(saved);
    }
    const started = await startNativePortForward(profileId);
    const projected = scope.applyStartResult(started);
    if (projected.status === "error") throw new Error(projected.error ?? "Could not open phone port");
    if (projected.status === "live" && projected.localPort !== null) return projected;
    return await scope.waitUntilLive(profileId);
  }

  async #reconcileDiscovered(connectionId: string, ports: readonly NativeDiscoveredPort[]): Promise<void> {
    const running = this.#reconciling.get(connectionId);
    if (running !== undefined) return await running;
    const task = this.#reconcileDiscoveredInner(connectionId, ports)
      .finally(() => this.#reconciling.delete(connectionId));
    this.#reconciling.set(connectionId, task);
    await task;
  }

  async #reconcileDiscoveredInner(connectionId: string, ports: readonly NativeDiscoveredPort[]): Promise<void> {
    const scope = this.scope(connectionId);
    await scope.load();
    for (const candidate of ports) {
      const profiles = scope.getSnapshot().profiles;
      const existing = profiles.find((profile) => profile.serviceKey === candidate.forwardingKey);
      if (existing === undefined) {
        if (!candidate.defaultForwardingEnabled) continue;
        await this.upsert({
          connectionId,
          profileId: automaticProfileId(candidate.forwardingKey),
          label: candidate.name,
          remotePort: candidate.port,
          preferredLocalPort: null,
          serviceKey: candidate.forwardingKey,
          preference: "automatic",
          startImmediately: true,
        });
        continue;
      }
      if (existing.preference === "excluded") continue;
      if (existing.serviceKey !== null && (existing.remotePort !== candidate.port || (existing.preference === "automatic" && existing.label !== candidate.name))) {
        await this.upsert({
          connectionId,
          profileId: existing.id,
          label: existing.preference === "automatic" ? candidate.name : existing.label,
          remotePort: candidate.port,
          preferredLocalPort: existing.preferredLocalPort,
          serviceKey: candidate.forwardingKey,
          preference: existing.preference,
          startImmediately: existing.enabled || existing.preference === "automatic",
        });
      } else if (existing.preference === "automatic" && !existing.enabled) {
        await this.start(connectionId, existing.id);
      }
    }
  }
}

export const nativePortForwardingStore = new NativePortForwardingStore();

export function useNativePortForwards(connectionId: string): readonly NativePortForwardProfile[] {
  const scope = nativePortForwardingStore.scope(connectionId);
  return useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getSnapshot).profiles;
}

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

function automaticProfileId(forwardingKey: string): string {
  return `auto-${forwardingKey.slice(0, 40)}`;
}
