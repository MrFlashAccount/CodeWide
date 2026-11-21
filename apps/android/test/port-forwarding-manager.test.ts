import { describe, expect, it } from "vitest";

import type {
  PortForwardingCandidate,
  PortForwardingProfile,
} from "../src/features/ports/portForwardingContract";
import { projectPortList } from "../src/features/ports/portListProjection";

function candidate(port: number, forwardingKey: string): PortForwardingCandidate {
  return {
    cwd: null,
    defaultForwardingEnabled: true,
    details: "",
    forwardingKey,
    group: "Apps",
    kind: "node",
    name: `service-${String(port)}`,
    pid: null,
    port,
    process: null,
  };
}

function profile(
  id: string,
  remotePort: number,
  serviceKey: string | null,
  status: PortForwardingProfile["status"],
): PortForwardingProfile {
  return {
    enabled: true,
    error: null,
    id,
    label: id,
    localPort: null,
    preference: "automatic",
    preferredLocalPort: null,
    previewUrl: null,
    remoteHost: "127.0.0.1",
    remotePort,
    serviceKey,
    status,
  };
}

describe("port forwarding manager", () => {
  it("keeps unavailable distinct from stopped and transport errors", () => {
    // Only profiles matching the current inventory are listed; unavailable
    // profiles leave the active segment without hiding stopped or errored ones.
    const listed = projectPortList(
      {
        discoveredPorts: [
          candidate(3000, "node:3000"),
          candidate(4000, "node:4000"),
          candidate(5000, "node:5000"),
        ],
        profiles: [
          profile("stopped", 3000, "node:3000", "stopped"),
          profile("errored", 4000, null, "error"),
          profile("unavailable", 5000, "node:5000", "unavailable"),
          profile("stale", 3000, "node:previous-3000", "stopped"),
        ],
      },
      "active",
      "",
    );
    expect(listed.counts).toEqual({ active: 2, available: 0, excluded: 0 });
    expect(
      listed.rows.flatMap((row) => (row.type === "profile" ? [row.profile.id] : [])).sort(),
    ).toEqual(["errored", "stopped"]);
  });

  it("offers a default-forwarded port the phone did not forward", () => {
    // Beyond its capacity the phone creates no automatic profile, so such a
    // port must stay reachable from Available instead of vanishing.
    const listed = projectPortList(
      {
        discoveredPorts: [candidate(3000, "node:3000"), candidate(4000, "node:4000")],
        profiles: [profile("forwarded", 3000, "node:3000", "live")],
      },
      "available",
      "",
    );
    expect(listed.counts).toEqual({ active: 1, available: 1, excluded: 0 });
    expect(
      listed.rows.flatMap((row) => (row.type === "candidate" ? [row.candidate.port] : [])),
    ).toEqual([4000]);
  });
});
