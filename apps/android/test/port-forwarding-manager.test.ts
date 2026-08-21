import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const manager = readFileSync(new URL("../src/ui/PortForwardingManager.tsx", import.meta.url), "utf8");
const nativeManager = readFileSync(
  new URL("../android/app/src/main/java/dev/codewide/app/remote/NativePortForwardManager.kt", import.meta.url),
  "utf8",
);
const companionPorts = readFileSync(new URL("../../companion/src/ports.rs", import.meta.url), "utf8");

describe("port forwarding manager", () => {
  it("carries Doma service identity and automatic policy from the companion", () => {
    expect(companionPorts).toContain("forwarding_key");
    expect(companionPorts).toContain("default_forwarding_enabled");
    expect(companionPorts).toContain('kind: "kubernetes"');
    expect(companionPorts).toContain('kind: "system"');
    expect(manager).toContain('type ServiceSegment = "active" | "available" | "excluded"');
    expect(manager).toContain("Name, category or port");
  });

  it("keeps unavailable distinct from stopped and transport errors", () => {
    expect(manager).toContain('"stopped" | "connecting" | "live" | "unavailable" | "error"');
    expect(manager).toContain('unavailable ? "Unavailable"');
    expect(nativeManager).toContain('if (confirmedPorts != null && profile.remotePort !in confirmedPorts) "unavailable"');
    expect(nativeManager).toContain('if (response?.code == 502) "unavailable" else "error"');
  });

  it("opens only live forwards and edits every non-live state", () => {
    expect(manager).toContain("onPress={live ? props.onOpen : props.onEdit}");
    expect(manager).toContain("props.onOpen(entry.profile)");
    expect(manager).not.toContain("browserProfileId");
  });
});
