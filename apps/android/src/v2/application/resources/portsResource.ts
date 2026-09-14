import type { V2PortDescriptor, V2TunnelCreateResponse } from "@codewide/sync-client/v2";

import type {
  PortForwardingDraft,
  PortForwardingEvent,
  PortForwardingProfile,
  PortForwardingPreference,
  PortTransport,
} from "../ports/portTransport";
import type { SavedServerId } from "../../domain/ids";
import { ObservableResource } from "./resource";

export type PortProfile = PortForwardingProfile;

export interface PortsProjection {
  discoveryError: string | null;
  discoveryStatus: "loading" | "ready" | "error";
  ports: V2PortDescriptor[];
  profileError: string | null;
  profiles: PortProfile[];
  scannedAt: number;
}

export interface CreatePortProfileInput {
  forwardingKey: string | null;
  label: string;
  port: number;
  preferredLocalPort: number | null;
  profileId: string | null;
  start: boolean;
}

const EMPTY: PortsProjection = {
  discoveryError: null,
  discoveryStatus: "loading",
  ports: [],
  profileError: null,
  profiles: [],
  scannedAt: 0,
};

export class PortsResource extends ObservableResource<PortsProjection> {
  readonly #transport: PortTransport;
  readonly #savedServerId: SavedServerId;
  readonly #unsubscribe: () => void;
  #refreshDirty = false;
  #refreshing: Promise<void> | null = null;
  #stopped = false;

  constructor(transport: PortTransport, savedServerId: SavedServerId) {
    super(EMPTY);
    this.#transport = transport;
    this.#savedServerId = savedServerId;
    this.#unsubscribe = transport.subscribe(this.#portEvent);
    void this.refresh().catch(() => undefined);
  }

  async createTunnel(port: number, ttlSeconds: number | null): Promise<V2TunnelCreateResponse> {
    return this.#transport.createTunnel(this.#savedServerId, port, ttlSeconds);
  }

  async deleteTunnel(tunnelId: string): Promise<void> {
    await this.#transport.deleteTunnel(this.#savedServerId, tunnelId);
  }

  override subscribe = (listener: () => void): (() => void) => this.addListener(listener);

  async create(input: CreatePortProfileInput): Promise<PortProfile> {
    await this.refresh();
    const currentPort = this.snapshot().value.ports.find((port) => port.port === input.port);
    if (currentPort === undefined) throw new Error("Port is not present in the current inventory");
    if (input.forwardingKey !== null && input.forwardingKey !== currentPort.forwardingKey) {
      throw new Error("Port service has changed");
    }
    const existing = this.snapshot().value.profiles.find(
      (profile) =>
        (input.profileId !== null && profile.id === input.profileId) ||
        profile.forwardingKey === currentPort.forwardingKey,
    );
    const profile = await this.#upsert({
      forwardingKey: currentPort.forwardingKey,
      label: input.label,
      port: input.port,
      preference: input.start ? includedPreference(existing) : "excluded",
      preferredLocalPort: input.preferredLocalPort,
      profileId: existing?.id ?? input.profileId ?? this.#transport.createProfileId(),
    });
    if (input.start) return this.#startProfile(profile);
    return profile.enabled ? this.#stopProfile(profile) : profile;
  }

  async exclude(port: V2PortDescriptor): Promise<PortProfile> {
    const existing = this.#profileForPort(port);
    return this.#upsert({
      forwardingKey: port.forwardingKey,
      label: existing?.label ?? displayName(port),
      port: port.port,
      preference: "excluded",
      preferredLocalPort: existing?.preferredLocalPort ?? null,
      profileId: existing?.id ?? this.#transport.createProfileId(),
    });
  }

  async include(forwardingKey: string): Promise<PortProfile> {
    const profile = this.snapshot().value.profiles.find(
      (candidate) => candidate.forwardingKey === forwardingKey,
    );
    if (profile === undefined) throw new Error("Excluded port forwarding profile was not found");
    const included = await this.#upsert({
      forwardingKey: profile.forwardingKey,
      label: profile.label,
      port: profile.port,
      preference: "included",
      preferredLocalPort: profile.preferredLocalPort,
      profileId: profile.id,
    });
    return this.#startProfile(included);
  }

  async reconnect(profileId: string): Promise<PortProfile> {
    const profile = this.#requireProfile(profileId);
    if (profile.enabled) await this.#stopProfile(profile);
    // Stop is an explicit exclusion at the native boundary. Reconnecting must
    // restore the previous policy, including automatic forwarding.
    const restored = await this.#upsert({
      forwardingKey: profile.forwardingKey,
      label: profile.label,
      port: profile.port,
      preference: includedPreference(profile),
      preferredLocalPort: profile.preferredLocalPort,
      profileId: profile.id,
    });
    return this.#startProfile(restored);
  }

  async remove(profileId: string): Promise<void> {
    this.#requireProfile(profileId);
    await this.#transport.remove(this.#savedServerId, profileId);
    await this.refresh();
  }

  async start(profileId: string): Promise<PortProfile> {
    let profile = this.#requireProfile(profileId);
    if (profile.preference === "excluded") {
      profile = await this.#upsert({
        forwardingKey: profile.forwardingKey,
        label: profile.label,
        port: profile.port,
        preference: "included",
        preferredLocalPort: profile.preferredLocalPort,
        profileId: profile.id,
      });
    }
    return this.#startProfile(profile);
  }

  async stop(profileId: string): Promise<PortProfile> {
    const profile = this.#requireProfile(profileId);
    if (profile.forwardingKey === null) return this.#stopProfile(profile);
    return this.#upsert({
      forwardingKey: profile.forwardingKey,
      label: profile.label,
      port: profile.port,
      preference: "excluded",
      preferredLocalPort: profile.preferredLocalPort,
      profileId: profile.id,
    });
  }

  stopResource(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#unsubscribe();
  }

  async refresh(): Promise<void> {
    if (this.#refreshing !== null) return this.#refreshing;
    this.#refreshing = this.#refresh().finally(() => {
      this.#refreshing = null;
      if (this.#refreshDirty && !this.#stopped) {
        this.#refreshDirty = false;
        void this.refresh().catch(() => undefined);
      }
    });
    return this.#refreshing;
  }

  async #refresh(): Promise<void> {
    const current = this.snapshot().value;
    this.publish({
      status: current.profiles.length === 0 && current.ports.length === 0 ? "loading" : "ready",
      value: {
        ...current,
        discoveryError: null,
        discoveryStatus: "loading",
        profileError: null,
      },
    });
    let profileError: string | null = null;
    try {
      const profiles = await this.#transport.list(this.#savedServerId);
      if (this.#stopped) return;
      this.#mergeLoadedProfiles(profiles);
    } catch (cause) {
      if (this.#stopped) return;
      profileError = errorMessage(cause, "Could not read current port forwards");
    }
    try {
      const discovered = await this.#transport.discover(this.#savedServerId);
      if (this.#stopped) return;
      // The native inventory owner creates/removes forwards before publishing.
      // Reload after it commits; JavaScript must not run a second reconciler.
      try {
        const profiles = await this.#transport.list(this.#savedServerId);
        if (this.#stopped) return;
        this.#mergeLoadedProfiles(profiles);
      } catch (cause) {
        profileError = errorMessage(cause, "Could not read current port forwards");
      }
      if (this.#stopped) return;
      const value = this.snapshot().value;
      this.publish({
        status: "ready",
        value: {
          ...value,
          discoveryError: null,
          discoveryStatus: discovered.scannedAt === 0 ? "loading" : "ready",
          ports: discovered.ports,
          profileError,
          scannedAt: discovered.scannedAt,
        },
      });
    } catch (cause) {
      if (this.#stopped) return;
      const value = this.snapshot().value;
      this.publish({
        status: "ready",
        value: {
          ...value,
          discoveryError: errorMessage(cause, "Could not discover server ports"),
          discoveryStatus: "error",
          profileError,
        },
      });
    }
  }

  readonly #portEvent = (event: PortForwardingEvent): void => {
    if (this.#stopped) return;
    if (event.type === "inventory" || event.type === "inventoryError") {
      if (event.savedServerId !== this.#savedServerId) return;
      if (event.type === "inventory") {
        this.#refreshDirty = this.#refreshing !== null;
        void this.refresh().catch(() => undefined);
      } else
        this.publish({
          status: "ready",
          value: {
            ...this.snapshot().value,
            discoveryStatus: "error",
            discoveryError: "Could not update server ports",
          },
        });
      return;
    }
    if (event.type === "removed") {
      this.#removeProfile(event.profileId);
      return;
    }
    if (event.profile.savedServerId === this.#savedServerId) this.#replaceProfile(event.profile);
  };

  async #startProfile(profile: PortProfile): Promise<PortProfile> {
    if (profile.status === "live" && profile.previewUrl !== null) return profile;
    const started = await this.#transport.start(this.#savedServerId, profile.id);
    return this.#replaceProfile(started);
  }

  async #stopProfile(profile: PortProfile): Promise<PortProfile> {
    const stopped = await this.#transport.stop(this.#savedServerId, profile.id);
    return this.#replaceProfile(stopped);
  }

  async #upsert(draft: PortForwardingDraft): Promise<PortProfile> {
    const profile = await this.#transport.upsert(this.#savedServerId, draft);
    return this.#replaceProfile(profile);
  }

  #profileForPort(port: V2PortDescriptor): PortProfile | undefined {
    return this.snapshot().value.profiles.find(
      (profile) =>
        profile.forwardingKey === port.forwardingKey ||
        (profile.forwardingKey === null && profile.port === port.port),
    );
  }

  #removeProfile(profileId: string): void {
    const value = this.snapshot().value;
    if (!value.profiles.some((profile) => profile.id === profileId)) return;
    this.publish({
      status: "ready",
      value: {
        ...value,
        profiles: value.profiles.filter((profile) => profile.id !== profileId),
      },
    });
  }

  #mergeLoadedProfiles(profiles: PortProfile[]): void {
    const current = new Map(
      this.snapshot().value.profiles.map((profile) => [profile.id, profile] as const),
    );
    const merged = profiles.map((profile) => preferCurrentPhase(current.get(profile.id), profile));
    this.#replaceProfiles(merged);
  }

  #replaceProfile(profile: PortProfile): PortProfile {
    const value = this.snapshot().value;
    const index = value.profiles.findIndex((candidate) => candidate.id === profile.id);
    if (index < 0) {
      this.#replaceProfiles([profile, ...value.profiles]);
      return profile;
    }
    const current = value.profiles[index];
    const authoritative = preferCurrentPhase(current, profile);
    if (authoritative === current) return current;
    const profiles = value.profiles.map((candidate, candidateIndex) =>
      candidateIndex === index ? authoritative : candidate,
    );
    this.#replaceProfiles(profiles);
    return authoritative;
  }

  #replaceProfiles(profiles: PortProfile[]): void {
    const value = this.snapshot().value;
    profiles.sort((left, right) => {
      const enabledOrder = Number(right.enabled) - Number(left.enabled);
      return enabledOrder === 0 ? right.updatedAt - left.updatedAt : enabledOrder;
    });
    this.publish({ status: "ready", value: { ...value, profiles } });
  }

  #requireProfile(profileId: string): PortProfile {
    const profile = this.snapshot().value.profiles.find((candidate) => candidate.id === profileId);
    if (profile === undefined) throw new Error("Port forwarding profile was not found");
    return profile;
  }
}

function displayName(port: V2PortDescriptor): string {
  return port.name === "" ? `Port ${port.port}` : port.name;
}

function includedPreference(profile: PortProfile | undefined): PortForwardingPreference {
  if (profile === undefined || profile.preference === "excluded") return "included";
  return profile.preference;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function preferCurrentPhase(current: PortProfile | undefined, incoming: PortProfile): PortProfile {
  if (
    incoming.status === "connecting" &&
    current !== undefined &&
    current.updatedAt >= incoming.updatedAt &&
    (current.status === "live" || current.status === "unavailable" || current.status === "error")
  ) {
    return current;
  }
  return incoming;
}
