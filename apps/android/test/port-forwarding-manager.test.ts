import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  PortForwardingCandidate,
  PortForwardingProfile,
} from "../src/features/ports/portForwardingContract";
import { projectPortList } from "../src/features/ports/portListProjection";
import { compactSource } from "./source-contract";

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

const manager = compactSource(
  readFileSync(new URL("../src/features/ports/PortForwardingManager.tsx", import.meta.url), "utf8"),
);
const composerRuntimeRoutes = compactSource(
  readFileSync(
    new URL("../src/features/composer/ComposerRuntimeRoutes.tsx", import.meta.url),
    "utf8",
  ),
);
const portsFeature = compactSource(
  readFileSync(new URL("../src/features/ports/PortsFeature.tsx", import.meta.url), "utf8"),
);
const nativeManager = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/remote/NativePortForwardManager.kt",
    import.meta.url,
  ),
  "utf8",
);
const companionPorts = readFileSync(
  new URL("../../../crates/companion-core/src/ports.rs", import.meta.url),
  "utf8",
);

const ownerPortForwardingContract = compactSource(
  readFileSync(new URL("../src/features/ports/portForwardingContract.ts", import.meta.url), "utf8"),
);
const ownerForwardingRow = compactSource(
  readFileSync(new URL("../src/features/ports/ForwardingRow.tsx", import.meta.url), "utf8"),
);

describe("port forwarding manager", () => {
  it("keeps loopback binding and authenticated Inner TLS while forwarding local bytes transparently", () => {
    expect(nativeManager).toContain('InetAddress.getByName("127.0.0.1")');
    expect(nativeManager).toContain("!client.inetAddress.isLoopbackAddress");
    expect(nativeManager).toContain("copyPortForwardInput(client.getInputStream())");
    expect(nativeManager).toContain(
      "InnerTlsTransport.url(saved, portForwardEndpoint(saved.endpoint, profile.remotePort))",
    );
    expect(nativeManager).toContain('header("Authorization", "Bearer ${credential.token}")');
    expect(nativeManager).toContain("InnerTlsTransport.client(baseClient, saved)");
    expect(nativeManager).not.toContain("PortForwardLocalAuthorization");
    expect(nativeManager).not.toContain("localCapability");
  });
  it("virtualizes individual rows with exact geometry instead of mounting entire groups", () => {
    expect(manager).toContain("<LegendList");
    expect(manager).toContain("data={rows}");
    expect(manager).toContain("getFixedItemSize=");
    expect(manager).not.toContain("estimatedItemSize");
    expect(manager).not.toContain("groupEntries.map");
    expect(manager).toContain('entry.type === "group" ? GROUP_HEIGHT : listRowHeight.double +');
    expect(manager).toContain("? PROFILE_ERROR_HEIGHT : 0");
  });

  it("gives the virtualized list sole ownership of sheet scrolling", () => {
    expect(portsFeature).toContain("renderScrollComponent={AppSheetScrollView}");
    expect(composerRuntimeRoutes).not.toContain(
      "<AppSheetScrollView>{children}</AppSheetScrollView>",
    );
    expect(composerRuntimeRoutes).toContain('performanceSurface="ports"');
    expect(composerRuntimeRoutes).toContain('section === "ports" ? "ports" : "sheet"');
  });

  it("keeps port actions in the native anchored menu instead of nesting a second sheet", () => {
    expect(manager).not.toContain("<ForwardingProfileActionsSheet");
    expect(ownerForwardingRow).toContain("<ActionMenu");
    expect(ownerForwardingRow).not.toContain("<AppSheet");
  });
  it("carries Doma service identity and automatic policy from the companion", () => {
    expect(companionPorts).toContain("forwarding_key");
    expect(companionPorts).toContain("default_forwarding_enabled");
    expect(companionPorts).toContain('kind: "kubernetes"');
    expect(companionPorts).toContain('kind: "system"');
    expect(ownerPortForwardingContract).toContain(
      'type ServiceSegment = "active" | "available" | "excluded"',
    );
    expect(manager).toContain("Name, category or port");
  });

  it("keeps unavailable distinct from stopped and transport errors", () => {
    expect(ownerPortForwardingContract).toContain(
      '"stopped" | "connecting" | "live" | "unavailable" | "error"',
    );
    expect(ownerForwardingRow).toContain('unavailable ? "Unavailable"');
    expect(nativeManager).toContain("inventoryReconciler.reconcile(pending.serverId, inventory)");
    expect(manager).not.toContain("Saved ports");
    // Only profiles matching the current inventory are listed; unavailable
    // profiles leave the active segment without hiding stopped or errored ones.
    const listed = projectPortList(
      {
        discoveredPorts: [candidate(3000, "node:3000"), candidate(4000, "node:4000"), candidate(5000, "node:5000")],
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
    expect(nativeManager).toContain("profile.serviceKey != currentKey");
    expect(nativeManager).toContain('502 -> PortForwardFailure("unavailable"');
  });

  it("opens only live forwards and edits every non-live state", () => {
    expect(ownerForwardingRow).toContain("onPress={live ? props.onOpen : props.onEdit}");
    expect(manager).toContain("props.onOpenBrowser(entry.profile.label, entry.profile.previewUrl)");
    expect(manager).not.toContain("browserProfileId");
  });
});
