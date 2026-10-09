import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const connectionFiles = [
  "ConnectionFeature.tsx",
  "HostUpdateNotice.tsx",
  "HostUpdateSettings.tsx",
  "hostUpdateContract.ts",
  "hostUpdateResource.ts",
  "hostUpdateResourceState.ts",
  "hostUpdateSettingsContract.ts",
  "hostUpdateTransport.ts",
  "hostUpdateWorkspaceBinding.ts",
  "useHostUpdateProjection.ts",
].map((name) =>
  readFileSync(new URL(`../src/features/connections/${name}`, import.meta.url), "utf8"),
);
const transport = readFileSync(
  new URL("../src/features/connections/hostUpdateTransport.ts", import.meta.url),
  "utf8",
);
const settings = readFileSync(
  new URL("../src/features/settings/SettingsFeature.tsx", import.meta.url),
  "utf8",
);

describe("Android host update ownership", () => {
  it("keeps transport and resource ownership out of Settings", () => {
    expect(settings).toContain('from "../connections/connectionSettingsContract"');
    expect(settings).not.toContain("hostUpdateTransport");
    expect(settings).not.toContain("hostUpdateResource");
    expect(settings).not.toContain("fetch(");
  });

  it("starts no host-update render load from an effect", () => {
    for (const source of connectionFiles) {
      expect(source).not.toMatch(/\buse(?:Layout)?Effect\b/u);
      expect(source).not.toMatch(/\buse(?:Callback|Memo)\b/u);
    }
  });

  it("uses only the authenticated private V1 host-update routes", () => {
    expect(transport).toContain('"/v1/host-update"');
    expect(transport).toContain('"/v1/host-update/check"');
    expect(transport).toContain('"/v1/host-update/apply"');
    expect(transport).toContain("/v1/host-update/operations/");
    expect(transport).toContain("scopedHttpAuthorization");
    expect(transport).toContain("nativeCompanionHttpOrigin");
    expect(transport).not.toMatch(/artifactUrl|downloadUrl|targetUrl/u);
  });
});
