import { describe, expect, it } from "vitest";
import { createConnectionProfileDatabase } from "../src/data/connection-profile-database.web";
import { createThreadUiStateDatabase } from "../src/data/thread-ui-state-database.web";
import { createPendingRequestDatabase } from "../src/data/pending-request-database.web";
import { createThreadDetailDatabase } from "../src/data/thread-detail-database.web";
import { createThreadSummaryDatabase } from "../src/data/thread-summary-database.web";

describe("browser database adapter contracts", () => {
  it("exposes readable collections and a stable composer resource", async () => {
    const profiles = createConnectionProfileDatabase();
    const ui = createThreadUiStateDatabase();
    try {
      await Promise.all([profiles.collection.preload(), ui.ready]);
      expect(profiles.collection.toArray).toEqual([]);
      const pending = ui.read("server", "thread");
      expect(ui.read("server", "thread")).toBe(pending);
      const row = await pending;
      expect(row).toMatchObject({
        connectionId: "server",
        threadId: "thread",
        draftText: "",
        attachments: [],
      });
      expect(ui.row$("server", "thread").peek()).toEqual(row);
    } finally {
      profiles.close();
      ui.close();
    }
  });

  it("rejects unavailable persisted stores explicitly", () => {
    expect(() => createPendingRequestDatabase()).toThrow("Android only");
    expect(() => createThreadDetailDatabase()).toThrow("Android only");
    expect(() => createThreadSummaryDatabase()).toThrow("Android build only");
  });
});
