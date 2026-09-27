import { describe, expect, it } from "vitest";

import {
  isProfileOnlyConnectionUpdate,
  validateConnectionInput,
  validateConnectionProfile,
  validateConnectionUpdateInput,
} from "../src/data/connection-validation.js";

describe("connection input validation", () => {
  it("accepts only known server icon ids", () => {
    expect(validateConnectionProfile(" Desktop ", "desktop")).toEqual({
      displayName: "Desktop",
      iconId: "desktop",
    });
    expect(() => validateConnectionProfile("Server", "unknown-icon")).toThrow("not supported");
    expect(() => validateConnectionProfile("Server", "🖥️")).toThrow("not supported");
    expect(() => validateConnectionProfile("bad\nname", "server")).toThrow("visible characters");
  });

  it("normalizes a host endpoint to the versioned sync path", () => {
    expect(
      validateConnectionInput({
        displayName: " Home ",
        iconId: "office",
        endpoint: "wss://codex.example.test",
        token: "a".repeat(43),
        tlsPinSha256: `sha256/${"A".repeat(43)}=`,
      }),
    ).toEqual({
      displayName: "Home",
      iconId: "office",
      endpoint: "wss://codex.example.test/v1/sync",
      token: "a".repeat(43),
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
    });
  });

  it("accepts a route-qualified Relay carrier and rejects malformed cleartext routes", () => {
    const route = "a".repeat(64);
    const input = {
      displayName: "Relay",
      iconId: "desktop" as const,
      endpoint: `ws://45.142.36.65:8780/c/${route}/v1/sync`,
      token: "a".repeat(43),
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
    };
    expect(validateConnectionInput(input).endpoint).toBe(input.endpoint);
    expect(() =>
      validateConnectionInput({ ...input, endpoint: "ws://45.142.36.65:8780/v1/sync" }),
    ).toThrow("wss://");
    expect(() =>
      validateConnectionInput({ ...input, endpoint: "ws://45.142.36.65:8780/c/short/v1/sync" }),
    ).toThrow("wss://");
    expect(() =>
      validateConnectionInput({ ...input, endpoint: `ws://45.142.36.65:8780/c/${route}/v1/other` }),
    ).toThrow("wss://");
  });

  it("rejects every profile without a companion identity pin", () => {
    expect(() =>
      validateConnectionInput({
        displayName: "Unpinned ingress",
        iconId: "managed",
        endpoint: "wss://legacy.example.test",
        token: "a".repeat(43),
      }),
    ).toThrow("TLS pin");
  });

  it.each([
    "https://codex.example.test/v1/sync",
    "ws://codex.example.test/v1/sync",
    "wss://user:secret@codex.example.test/v1/sync",
    "wss://codex.example.test/v1/app-server",
    "wss://codex.example.test/v1/sync?token=leak",
  ])("rejects unsafe or incompatible endpoint %s", (endpoint) => {
    expect(() =>
      validateConnectionInput({
        displayName: "Home",
        iconId: "office",
        endpoint,
        token: "a".repeat(43),
        tlsPinSha256: `sha256/${"A".repeat(43)}=`,
      }),
    ).toThrow();
  });

  it.each([
    "ws://localhost/v1/sync",
    "ws://127.0.0.1/v1/sync",
    "ws://[::1]/v1/sync",
    "ws://10.0.2.2/v1/sync",
  ])("permits cleartext only for local development: %s", (endpoint) => {
    expect(
      validateConnectionInput({
        displayName: "Local",
        iconId: "terminal",
        endpoint,
        token: "a".repeat(43),
        tlsPinSha256: `sha256/${"A".repeat(43)}=`,
      }).endpoint,
    ).toBe(endpoint);
  });

  it("keeps the current capability when an edit leaves the replacement blank", () => {
    const currentToken = "a".repeat(43);
    expect(
      validateConnectionUpdateInput(
        {
          displayName: "Renamed",
          iconId: "terminal",
          endpoint: "wss://new.example.test/v1/sync",
          token: "   ",
          tlsPinSha256: `sha256/${"A".repeat(43)}=`,
        },
        currentToken,
      ),
    ).toEqual({
      displayName: "Renamed",
      iconId: "terminal",
      endpoint: "wss://new.example.test/v1/sync",
      token: currentToken,
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
    });
  });

  it("routes a rename through the profile-only update without touching transport credentials", () => {
    const current = {
      endpoint: "wss://codex.example.test/v1/sync",
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
    };
    expect(
      isProfileOnlyConnectionUpdate(
        {
          displayName: "Renamed",
          iconId: "cloud",
          endpoint: current.endpoint,
          token: "   ",
          tlsPinSha256: current.tlsPinSha256,
        },
        current,
      ),
    ).toBe(true);
  });

  it("keeps endpoint, capability and pin edits on the full connection-update path", () => {
    const current = { endpoint: "wss://codex.example.test/v1/sync" };
    expect(
      isProfileOnlyConnectionUpdate(
        { displayName: "Name", iconId: "cloud", endpoint: "wss://other.example.test/v1/sync" },
        current,
      ),
    ).toBe(false);
    expect(
      isProfileOnlyConnectionUpdate(
        { displayName: "Name", iconId: "cloud", endpoint: current.endpoint, token: "replacement" },
        current,
      ),
    ).toBe(false);
    expect(
      isProfileOnlyConnectionUpdate(
        {
          displayName: "Name",
          iconId: "cloud",
          endpoint: current.endpoint,
          tlsPinSha256: `sha256/${"A".repeat(43)}=`,
        },
        current,
      ),
    ).toBe(false);
  });
});
