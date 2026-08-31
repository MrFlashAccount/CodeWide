import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("companion transport trust boundary", () => {
  it("routes every React Native companion HTTP surface through the native pinned origin", () => {
    const workspace = read("../src/data/use-remote-workspace.ts");
    expect(workspace).toContain("nativeCompanionHttpOrigin");
    expect(workspace).not.toContain("companionHttpUrl(connection.endpoint");
    expect(workspace.match(/nativeCompanionHttpOrigin\(connection\.id, connection\.endpoint\)/gu)).toHaveLength(4);

    const privateTransfer = read("../src/data/private-transfer.ts");
    expect(privateTransfer).toContain("new URL(access.baseUrl)");
    expect(privateTransfer).not.toContain("wss://");
  });

  it("centralizes self-signed trust, expiry and SPKI mismatch handling", () => {
    const pinnedTls = read("../android/app/src/main/java/dev/codewide/app/remote/PinnedTls.kt");
    expect(pinnedTls).toContain("chain[0].checkValidity()");
    expect(pinnedTls).toContain("pinFor(chain[0])");
    expect(pinnedTls).not.toContain("chain.any");
    expect(pinnedTls).toContain("Companion identity pin mismatch");
    expect(pinnedTls).toContain("PinTrustManager verifies the exact leaf SPKI during the TLS handshake");
    expect(pinnedTls).not.toContain("CertificatePinner.Builder()");
    expect(pinnedTls).toContain("saved Companion pin is deliberately");

    const nativeProxy = read("../android/app/src/main/java/dev/codewide/app/remote/NativeCompanionHttpProxy.kt");
    expect(nativeProxy).toContain("InnerTlsTransport.openSocket");
    expect(nativeProxy).not.toContain("SSLSocket");

    const innerTls = read("../android/app/src/main/java/dev/codewide/app/remote/InnerTlsTransport.kt");
    expect(innerTls).toContain("PinnedTls.client");
    expect(innerTls).toContain("PinnedTls.innerTlsClient");
    for (const [source, transportFactory] of [
      ["CodeWideModule.kt", "InnerTlsTransport.bootstrapClient"],
      ["CodexConnectionService.kt", "InnerTlsTransport.client"],
      ["NativePortForwardManager.kt", "InnerTlsTransport.client"],
      ["SessionCredentialClient.kt", "InnerTlsTransport.client"],
      ["NativeTerminalSessionManager.kt", "InnerTlsTransport.client"],
    ] as const) {
      const contents = read(`../android/app/src/main/java/dev/codewide/app/remote/${source}`);
      expect(contents).toContain(transportFactory);
      expect(contents).not.toContain("CertificatePinner.Builder()");
    }
  });

  it("has no opt-out, legacy transport state, or upgrade path", () => {
    const credentials = read("../android/app/src/main/java/dev/codewide/app/remote/NativeSessionCredentialsStore.kt");
    expect(credentials).toContain("val innerTlsPinSha256: String");
    expect(credentials).toContain("Secure pairing requires a Companion identity pin");
    expect(credentials).not.toContain("certificatePinningEnabled");
    expect(credentials).not.toContain("InnerTlsMode");

    const nativeModule = read("../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt");
    expect(nativeModule).toContain("Secure pairing requires a Companion identity pin");
    expect(nativeModule).not.toContain("setCertificatePinningEnabled");
    expect(nativeModule).not.toContain("saveSecureConnectionCredentials");

    const bridge = read("../src/native/native-transport.native.ts");
    expect(bridge).toContain("tlsPinSha256: string;");
    expect(bridge).not.toContain("saveSecureConnectionCredentials");
    expect(bridge).not.toContain("CertificatePinningSetting");

    const screen = read("../src/CodeWideScreen.tsx");
    expect(screen).toContain("Companion identity pin (required)");
    expect(screen).not.toContain("End-to-end encryption preview");
  });

  it("persists the authoritative paired device id and fails V2 closed when it is absent", () => {
    const credentials = read("../android/app/src/main/java/dev/codewide/app/remote/NativeSessionCredentialsStore.kt");
    expect(credentials).toContain("val deviceId: String? = null");
    expect(credentials).toContain('put("deviceId", requireNotNull(session.deviceId)');
    expect(credentials).toContain('Regex("^device-[a-f0-9]{64}$")');

    const nativeModule = read("../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt");
    expect(nativeModule).toContain("fun saveConnectionCredentialsV2(");
    expect(nativeModule).toContain('putString("deviceId", saved.deviceId)');
    expect(nativeModule).toContain('putString("savedServerId", saved.id)');

    const workspace = read("../src/data/use-remote-workspace.ts");
    expect(workspace).toContain("deviceId: claimed.deviceId");
    expect(workspace).not.toContain("syncV2Lifecycle");
  });
});
