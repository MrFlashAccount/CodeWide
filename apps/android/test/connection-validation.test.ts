import { describe, expect, it } from "vitest";

import { isProfileOnlyConnectionUpdate, validateConnectionInput, validateConnectionProfile, validateConnectionUpdateInput } from "../src/data/connection-validation.js";

describe("connection input validation", () => {
  it("accepts exactly one extended emoji grapheme", () => {
    expect(validateConnectionProfile("Desktop", "🖥️").emoji).toBe("🖥️");
    expect(validateConnectionProfile(" Fold ", "👨🏽‍💻")).toEqual({ displayName: "Fold", emoji: "👨🏽‍💻" });
    expect(validateConnectionProfile("Flag", "🇫🇮").emoji).toBe("🇫🇮");
    expect(validateConnectionProfile("Keycap", "1️⃣").emoji).toBe("1️⃣");
    expect(() => validateConnectionProfile("Server", "🚀🧪")).toThrow("one emoji");
    expect(() => validateConnectionProfile("Server", "A")).toThrow("one emoji");
    expect(() => validateConnectionProfile("bad\nname", "🚀")).toThrow("visible characters");
  });

  it("validates one emoji when Hermes does not expose Intl.Segmenter", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter");
    Object.defineProperty(Intl, "Segmenter", { configurable: true, value: undefined });
    try {
      expect(validateConnectionProfile("Desktop", "🖥️").emoji).toBe("🖥️");
      expect(validateConnectionProfile("Engineer", "👨🏽‍💻").emoji).toBe("👨🏽‍💻");
      expect(() => validateConnectionProfile("Too many", "🚀🧪")).toThrow("one emoji");
    } finally {
      if (descriptor === undefined) delete (Intl as { Segmenter?: unknown }).Segmenter;
      else Object.defineProperty(Intl, "Segmenter", descriptor);
    }
  });

  it("normalizes a host endpoint to the versioned sync path", () => {
    expect(validateConnectionInput({
      displayName: " Home ",
      emoji: " 🏠 ",
      endpoint: "wss://codex.example.test",
      token: "a".repeat(43),
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
    })).toEqual({
      displayName: "Home",
      emoji: "🏠",
      endpoint: "wss://codex.example.test/v1/sync",
      token: "a".repeat(43),
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
    });
  });

  it("rejects every profile without a companion identity pin", () => {
    expect(() => validateConnectionInput({
      displayName: "Unpinned ingress",
      emoji: "🔒",
      endpoint: "wss://legacy.example.test",
      token: "a".repeat(43),
    })).toThrow("TLS pin");
  });

  it.each([
    "https://codex.example.test/v1/sync",
    "ws://codex.example.test/v1/sync",
    "wss://user:secret@codex.example.test/v1/sync",
    "wss://codex.example.test/v1/app-server",
    "wss://codex.example.test/v1/sync?token=leak",
  ])("rejects unsafe or incompatible endpoint %s", (endpoint) => {
    expect(() => validateConnectionInput({
      displayName: "Home",
      emoji: "🏠",
      endpoint,
      token: "a".repeat(43),
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
    })).toThrow();
  });

  it.each([
    "ws://localhost/v1/sync",
    "ws://127.0.0.1/v1/sync",
    "ws://[::1]/v1/sync",
    "ws://10.0.2.2/v1/sync",
  ])("permits cleartext only for local development: %s", (endpoint) => {
    expect(validateConnectionInput({
      displayName: "Local",
      emoji: "🧪",
      endpoint,
      token: "a".repeat(43),
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
    }).endpoint).toBe(endpoint);
  });

  it("keeps the current capability when an edit leaves the replacement blank", () => {
    const currentToken = "a".repeat(43);
    expect(validateConnectionUpdateInput({
      displayName: "Renamed",
      emoji: "🧪",
      endpoint: "wss://new.example.test/v1/sync",
      token: "   ",
      tlsPinSha256: `sha256/${"A".repeat(43)}=`,
    }, currentToken)).toEqual({
      displayName: "Renamed",
      emoji: "🧪",
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
    expect(isProfileOnlyConnectionUpdate({
      displayName: "Renamed",
      emoji: "🚀",
      endpoint: current.endpoint,
      token: "   ",
      tlsPinSha256: current.tlsPinSha256,
    }, current)).toBe(true);
  });

  it("keeps endpoint, capability and pin edits on the full connection-update path", () => {
    const current = { endpoint: "wss://codex.example.test/v1/sync" };
    expect(isProfileOnlyConnectionUpdate({ displayName: "Name", emoji: "🚀", endpoint: "wss://other.example.test/v1/sync" }, current)).toBe(false);
    expect(isProfileOnlyConnectionUpdate({ displayName: "Name", emoji: "🚀", endpoint: current.endpoint, token: "replacement" }, current)).toBe(false);
    expect(isProfileOnlyConnectionUpdate({ displayName: "Name", emoji: "🚀", endpoint: current.endpoint, tlsPinSha256: `sha256/${"A".repeat(43)}=` }, current)).toBe(false);
  });
});
