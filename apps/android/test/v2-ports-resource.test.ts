import type { V2PortDescriptor, V2PortsResponse } from "@codewide/sync-client/v2";
import { describe, expect, it } from "vitest";

import type {
  PortForwardingDraft,
  PortForwardingEvent,
  PortForwardingProfile,
  PortTransport,
} from "../src/v2/application/ports/portTransport";
import { PortsResource } from "../src/v2/application/resources/portsResource";
import { savedServerId, type SavedServerId } from "../src/v2/domain/ids";

const SERVER = savedServerId("server-1");
const FORWARDING_KEY = "a".repeat(64);

class PersistentPortTransport implements PortTransport {
  readonly createdTunnels: { port: number; ttlSeconds: number | null }[] = [];
  readonly deletedTunnels: string[] = [];
  readonly profiles = new Map<string, PortForwardingProfile>();
  readonly starts: string[] = [];
  readonly stops: string[] = [];
  readonly #listeners = new Set<(event: PortForwardingEvent) => void>();
  discovery: V2PortsResponse = { ports: [], scannedAt: 1 };
  emitLiveBeforeStartReturns = false;
  listFailure: Error | null = null;
  #nextId = 1;

  createProfileId(): string {
    const id = `profile-${this.#nextId}`;
    this.#nextId += 1;
    return id;
  }

  async createTunnel(
    _id: SavedServerId,
    port: number,
    ttlSeconds: number | null,
  ): Promise<{ basePath: string; expiresAt: number; id: string }> {
    this.createdTunnels.push({ port, ttlSeconds });
    return { basePath: "/v2/tunnels/tunnel-1/", expiresAt: 10_000, id: "tunnel-1" };
  }

  async deleteTunnel(_id: SavedServerId, tunnelId: string): Promise<void> {
    this.deletedTunnels.push(tunnelId);
  }

  async discover(): Promise<V2PortsResponse> {
    return this.discovery;
  }

  async list(id: SavedServerId): Promise<PortForwardingProfile[]> {
    if (this.listFailure !== null) throw this.listFailure;
    return Array.from(this.profiles.values()).filter((profile) => profile.savedServerId === id);
  }

  async remove(_id: SavedServerId, profileId: string): Promise<void> {
    this.profiles.delete(profileId);
    this.#emit({ profileId, type: "removed" });
  }

  async start(_id: SavedServerId, profileId: string): Promise<PortForwardingProfile> {
    const current = this.#require(profileId);
    const profile = {
      ...current,
      enabled: true,
      error: null,
      status: "connecting" as const,
      updatedAt: current.updatedAt + 1,
    };
    this.profiles.set(profileId, profile);
    this.starts.push(profileId);
    this.#emit({ profile, type: "profile" });
    if (this.emitLiveBeforeStartReturns) this.emitLive(profileId, 30_000);
    return profile;
  }

  async stop(_id: SavedServerId, profileId: string): Promise<PortForwardingProfile> {
    const current = this.#require(profileId);
    const profile = {
      ...current,
      enabled: false,
      localPort: null,
      previewUrl: null,
      status: "stopped" as const,
      updatedAt: current.updatedAt + 1,
    };
    this.profiles.set(profileId, profile);
    this.stops.push(profileId);
    this.#emit({ profile, type: "profile" });
    return profile;
  }

  subscribe(listener: (event: PortForwardingEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async upsert(id: SavedServerId, draft: PortForwardingDraft): Promise<PortForwardingProfile> {
    const current = this.profiles.get(draft.profileId);
    const excluded = draft.preference === "excluded";
    const profile: PortForwardingProfile = {
      enabled: excluded ? false : (current?.enabled ?? false),
      error: null,
      forwardingKey: draft.forwardingKey,
      id: draft.profileId,
      label: draft.label,
      localPort: excluded ? null : (current?.localPort ?? null),
      port: draft.port,
      preference: draft.preference,
      preferredLocalPort: draft.preferredLocalPort,
      previewUrl: excluded ? null : (current?.previewUrl ?? null),
      savedServerId: id,
      status: excluded ? "stopped" : (current?.status ?? "stopped"),
      updatedAt: (current?.updatedAt ?? 0) + 1,
    };
    this.profiles.set(profile.id, profile);
    this.#emit({ profile, type: "profile" });
    return profile;
  }

  emitLive(profileId: string, localPort: number): void {
    const current = this.#require(profileId);
    const profile: PortForwardingProfile = {
      ...current,
      localPort,
      previewUrl: `http://127.0.0.1:${localPort}/`,
      status: "live",
      updatedAt: current.updatedAt + 1,
    };
    this.profiles.set(profileId, profile);
    this.#emit({ profile, type: "profile" });
  }

  emitError(profileId: string): void {
    const current = this.#require(profileId);
    const profile: PortForwardingProfile = {
      ...current,
      error: "Remote stream failed",
      status: "error",
      updatedAt: current.updatedAt + 1,
    };
    this.profiles.set(profileId, profile);
    this.#emit({ profile, type: "profile" });
  }

  #emit(event: PortForwardingEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  #require(profileId: string): PortForwardingProfile {
    const profile = this.profiles.get(profileId);
    if (profile === undefined) throw new Error("Missing test profile");
    return profile;
  }
}

describe("V2 durable port resource", () => {
  it("restores a live native profile after the JavaScript runtime is recreated", async () => {
    const transport = new PersistentPortTransport();
    const first = new PortsResource(transport, SERVER);
    await first.refresh();
    const connecting = await first.create({
      forwardingKey: null,
      label: "Dev server",
      port: 3_000,
      preferredLocalPort: 30_000,
      profileId: null,
      start: true,
    });
    expect(connecting.status).toBe("connecting");
    transport.emitLive(connecting.id, 30_000);
    expect(first.snapshot().value.profiles[0]?.previewUrl).toBe("http://127.0.0.1:30000/");

    first.stopResource();
    const recreated = new PortsResource(transport, SERVER);
    await recreated.refresh();
    expect(recreated.snapshot().value.profiles).toEqual([
      expect.objectContaining({
        enabled: true,
        id: connecting.id,
        preferredLocalPort: 30_000,
        status: "live",
      }),
    ]);
  });

  it("persists exclusions and only starts them after an explicit include", async () => {
    const transport = new PersistentPortTransport();
    const port = discoveredPort();
    transport.discovery = { ports: [port], scannedAt: 2 };
    const first = new PortsResource(transport, SERVER);
    await first.refresh();
    const excluded = await first.exclude(port);
    expect(excluded).toMatchObject({ enabled: false, preference: "excluded" });

    first.stopResource();
    const recreated = new PortsResource(transport, SERVER);
    await recreated.refresh();
    expect(recreated.snapshot().value.profiles[0]?.preference).toBe("excluded");
    expect(transport.starts).toEqual([]);

    await recreated.include(FORWARDING_KEY);
    expect(transport.starts).toEqual([excluded.id]);
    expect(recreated.snapshot().value.profiles[0]).toMatchObject({
      enabled: true,
      preference: "included",
      status: "connecting",
    });
  });

  it("persists and starts automatic profiles discovered after a cold launch", async () => {
    const transport = new PersistentPortTransport();
    transport.discovery = {
      ports: [{ ...discoveredPort(), defaultForwardingEnabled: true }],
      scannedAt: 3,
    };
    const resource = new PortsResource(transport, SERVER);
    await resource.refresh();
    expect(resource.snapshot().value.profiles[0]).toMatchObject({
      enabled: true,
      forwardingKey: FORWARDING_KEY,
      preference: "automatic",
      status: "connecting",
    });
    expect(transport.starts).toEqual(["profile-1"]);
  });

  it("keeps a native live event that wins the race with the start response", async () => {
    const transport = new PersistentPortTransport();
    transport.emitLiveBeforeStartReturns = true;
    const resource = new PortsResource(transport, SERVER);
    await resource.refresh();

    const live = await resource.create({
      forwardingKey: null,
      label: "Dev server",
      port: 3_000,
      preferredLocalPort: 30_000,
      profileId: null,
      start: true,
    });

    expect(live).toMatchObject({
      enabled: true,
      previewUrl: "http://127.0.0.1:30000/",
      status: "live",
    });
    expect(resource.snapshot().value.profiles[0]).toEqual(live);
  });

  it("reconnects an errored profile by replacing its native listener", async () => {
    const transport = new PersistentPortTransport();
    const resource = new PortsResource(transport, SERVER);
    await resource.refresh();
    const profile = await resource.create({
      forwardingKey: null,
      label: "Dev server",
      port: 3_000,
      preferredLocalPort: null,
      profileId: null,
      start: true,
    });
    transport.emitError(profile.id);

    await resource.reconnect(profile.id);

    expect(transport.stops).toEqual([profile.id]);
    expect(transport.starts).toEqual([profile.id, profile.id]);
    expect(resource.snapshot().value.profiles[0]).toMatchObject({
      enabled: true,
      error: null,
      status: "connecting",
    });
  });

  it("creates and revokes bounded tunnels through the shared port transport", async () => {
    const transport = new PersistentPortTransport();
    const resource = new PortsResource(transport, SERVER);
    await resource.refresh();

    const tunnel = await resource.createTunnel(3_000, 900);
    await resource.deleteTunnel(tunnel.id);

    expect(tunnel).toEqual({
      basePath: "/v2/tunnels/tunnel-1/",
      expiresAt: 10_000,
      id: "tunnel-1",
    });
    expect(transport.createdTunnels).toEqual([{ port: 3_000, ttlSeconds: 900 }]);
    expect(transport.deletedTunnels).toEqual(["tunnel-1"]);
  });

  it("still discovers current listeners when persisted profile loading fails", async () => {
    const transport = new PersistentPortTransport();
    transport.listFailure = new Error("Profile store unavailable");
    transport.discovery = { ports: [discoveredPort()], scannedAt: 9 };
    const resource = new PortsResource(transport, SERVER);

    await resource.refresh();

    expect(resource.snapshot()).toEqual({
      status: "ready",
      value: {
        discoveryError: null,
        discoveryStatus: "ready",
        ports: [discoveredPort()],
        profileError: "Profile store unavailable",
        profiles: [],
        scannedAt: 9,
      },
    });
  });
});

function discoveredPort(): V2PortDescriptor {
  return {
    cwd: "/workspace/app",
    defaultForwardingEnabled: false,
    details: "node dev server",
    forwardingKey: FORWARDING_KEY,
    group: "Development",
    kind: "node",
    name: "Web",
    pid: 42,
    port: 3_000,
    process: "node",
  };
}
