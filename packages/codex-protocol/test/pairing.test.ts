import { describe, expect, it } from "vitest";

import { encodePairingLink, encodePairingPayload, parsePairingPayload } from "../src/pairing.js";

describe("CodeWide pairing QR", () => {
  it("round-trips a bounded one-time WSS payload", () => {
    const now = Date.now();
    const encoded = encodePairingPayload({
      type: "codewide-pairing",
      version: 1,
      endpoint: "wss://host.example/v1/sync",
      pairingToken: "x".repeat(43),
      expiresAt: now + 60_000,
      displayName: "Workstation",
      emoji: "🧪",
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
      identityExpiresAt: now + 365 * 24 * 60 * 60_000,
    });
    expect(encoded).toMatch(/^[\x20-\x7e]+$/);
    expect(parsePairingPayload(encoded, now)).toMatchObject({
      endpoint: "wss://host.example/v1/sync",
      emoji: "🧪",
    });
  });

  it("rejects expired, oversized and cleartext remote payloads", () => {
    const base = {
      type: "codewide-pairing",
      version: 1,
      endpoint: "wss://host.example/v1/sync",
      pairingToken: "x".repeat(43),
      expiresAt: 1_001_000,
      displayName: "Host",
      emoji: "🖥️",
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
    } as const;
    expect(() => parsePairingPayload(JSON.stringify({ ...base, expiresAt: 999_999 }), 1_000_000)).toThrow("expired");
    expect(() => parsePairingPayload(JSON.stringify({ ...base, endpoint: "ws://host.example/v1/sync" }), 1_000_000)).toThrow("WSS");
    expect(() => parsePairingPayload("x".repeat(4_097), 1_000_000)).toThrow("too large");
  });

  it("round-trips a one-tap app link without weakening payload validation", () => {
    const now = Date.now();
    const link = encodePairingLink({
      type: "codewide-pairing",
      version: 1,
      endpoint: "wss://remote.example.test/v1/sync",
      pairingToken: "t".repeat(43),
      expiresAt: now + 60_000,
      displayName: "Home workstation",
      emoji: "🏠",
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
    });
    expect(link).toMatch(/^codewide:\/\/pair\?/);
    expect(parsePairingPayload(link, now)).toMatchObject({
      endpoint: "wss://remote.example.test/v1/sync",
      displayName: "Home workstation",
      emoji: "🏠",
    });
    expect(() => parsePairingPayload(link.replace("v=1", "v=2"), now)).toThrow("Unsupported pairing QR");
    expect(() => parsePairingPayload(link.replace("codewide://pair", "codewide://thread"), now)).toThrow("Unsupported");
  });

  it("accepts the legacy brand alias only when the payload remains securely pinned", () => {
    const now = Date.now();
    const legacy = {
      type: "codex-remote-pairing",
      version: 1,
      endpoint: "wss://legacy.example.test/v1/sync",
      pairingToken: "t".repeat(43),
      expiresAt: now + 60_000,
      displayName: "Legacy host",
      emoji: "🖥️",
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
    };
    expect(parsePairingPayload(JSON.stringify(legacy), now)).toMatchObject({
      type: "codewide-pairing",
      endpoint: legacy.endpoint,
    });
    const currentLink = encodePairingLink({ ...legacy, type: "codewide-pairing" });
    expect(parsePairingPayload(currentLink.replace("codewide://", "codexremote://"), now)).toMatchObject({
      type: "codewide-pairing",
      endpoint: legacy.endpoint,
    });

    const legacyUnpinned = { ...legacy, tlsPinSha256: undefined };
    expect(() => parsePairingPayload(JSON.stringify(legacyUnpinned), now)).toThrow("certificate pin");
  });
});
