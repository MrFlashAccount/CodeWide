import { describe, expect, it } from "vitest";

import {
  connectionProfileRowFromUnknown,
  decodeConnectionProfileRow,
} from "../src/data/connectionProfilePersistence.js";
import type { StoredConnection } from "../src/data/connection-profile-types.js";
import { serverIconIdFromLegacy, serverIconOptions } from "../src/data/serverIcons.js";
import { ThreadServerProjection } from "../src/features/connections/connectionPresentation.js";

const legacyRow = {
  displayName: "Legacy laptop",
  emoji: "💻",
  enabled: true,
  endpoint: "wss://example.test/v1/sync",
  id: "legacy",
  sortOrder: 0,
  tlsPinSha256: null,
  updatedAt: 1,
};

describe("server icon contract", () => {
  it("offers a fixed inventory of at least sixteen unique stable ids", () => {
    expect(serverIconOptions.map((option) => option.id)).toStrictEqual([
      "desktop",
      "laptop",
      "server",
      "terminal",
      "cloud",
      "network",
      "globe",
      "chip",
      "code",
      "cluster",
      "container",
      "wifi",
      "radio",
      "phone",
      "tablet",
      "office",
      "build",
      "managed",
    ]);
    expect(new Set(serverIconOptions.map((option) => option.id)).size).toBe(
      serverIconOptions.length,
    );
    expect(new Set(serverIconOptions.map((option) => option.name)).size).toBe(
      serverIconOptions.length,
    );
  });

  it("keeps every declared legacy emoji mapping unambiguous", () => {
    const mappings = serverIconOptions.flatMap((option) =>
      option.legacyEmoji.map((emoji) => ({ emoji, iconId: option.id })),
    );
    expect(new Set(mappings.map(({ emoji }) => emoji)).size).toBe(mappings.length);
    for (const { emoji, iconId } of mappings) {
      expect(serverIconIdFromLegacy(undefined, emoji)).toBe(iconId);
    }
  });

  it("migrates legacy emoji and falls back from unknown persisted ids", () => {
    expect(connectionProfileRowFromUnknown(legacyRow)).toMatchObject({
      iconId: "laptop",
      id: "legacy",
    });
    expect(
      connectionProfileRowFromUnknown({ ...legacyRow, emoji: "🫠", iconId: "retired" }).iconId,
    ).toBe("desktop");
  });

  it("round-trips only the stable icon id through persisted JSON", () => {
    const current = connectionProfileRowFromUnknown({ ...legacyRow, iconId: "cloud" });
    const restored = decodeConnectionProfileRow(JSON.stringify(current));
    expect(restored).toEqual(current);
    expect(restored).not.toHaveProperty("emoji");
  });

  it("projects icon changes and preserves identity for unchanged server snapshots", () => {
    const projection = new ThreadServerProjection();
    const connection: StoredConnection = {
      displayName: "Build host",
      enabled: true,
      endpoint: "wss://example.test/v1/sync",
      iconId: "build",
      id: "server",
      lastError: null,
      lastErrorAt: null,
      sortOrder: 0,
      state: "live",
      token: "",
    };
    const first = projection.project([connection]);
    expect(first[0]).toMatchObject({ iconId: "build", name: "Build host" });
    expect(projection.project([connection])).toBe(first);
    expect(projection.project([{ ...connection, iconId: "server" }])).not.toBe(first);
  });
});
