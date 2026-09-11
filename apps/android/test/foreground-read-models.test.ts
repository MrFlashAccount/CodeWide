import { describe, expect, it, vi } from "vitest";
import { refreshForegroundReadModels, type ForegroundReadModels } from "../src/data/foreground-read-models";

function fixture() {
  const models: ForegroundReadModels = {
    desiredThreadId: vi.fn(() => "visible-thread"),
    refreshCatalog: vi.fn(async () => undefined),
    refreshThread: vi.fn(async () => undefined),
  };
  return models;
}

describe("foreground read-model freshness", () => {
  it("refreshes the visible thread without needing a reconnect or a live-state edge", async () => {
    const models = fixture();
    await refreshForegroundReadModels("server-a", models);
    expect(models.refreshThread).toHaveBeenCalledExactlyOnceWith("server-a", "visible-thread");
    expect(models.refreshCatalog).toHaveBeenCalledExactlyOnceWith("server-a");
  });

  it("does not load arbitrary chats when no thread is selected", async () => {
    const models = fixture();
    models.desiredThreadId = () => undefined;
    await refreshForegroundReadModels("server-a", models);
    expect(models.refreshCatalog).toHaveBeenCalledExactlyOnceWith("server-a");
    expect(models.refreshThread).not.toHaveBeenCalled();
  });

  it("does not hold visible conversation repair behind a slow sidebar", async () => {
    const models = fixture();
    const catalog = Promise.withResolvers<void>();
    models.refreshCatalog = () => catalog.promise;
    const operation = refreshForegroundReadModels("server-a", models);
    try {
      expect(models.refreshThread).toHaveBeenCalledExactlyOnceWith("server-a", "visible-thread");
    } finally {
      catalog.resolve();
      await operation;
    }
  });

  it("does not report recovery complete before thread and pending reconciliation finishes", async () => {
    const models = fixture();
    const thread = Promise.withResolvers<void>();
    models.refreshThread = () => thread.promise;
    const completed = vi.fn();
    const operation = refreshForegroundReadModels("server-a", models).then(completed);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      expect(completed).not.toHaveBeenCalled();
    } finally {
      thread.resolve();
      await operation;
    }
    expect(completed).toHaveBeenCalledOnce();
  });

  it("surfaces conversation repair errors even if the sidebar refreshed", async () => {
    const models = fixture();
    const failure = new Error("Conversation refresh failed");
    models.refreshThread = async () => { throw failure; };
    await expect(refreshForegroundReadModels("server-a", models)).rejects.toBe(failure);
  });

  it("does not abandon thread recovery when the catalog fails", async () => {
    const models = fixture();
    const thread = Promise.withResolvers<void>();
    const failure = new Error("Catalog unavailable");
    models.refreshCatalog = async () => { throw failure; };
    models.refreshThread = () => thread.promise;
    const failed = vi.fn();
    const operation = refreshForegroundReadModels("server-a", models).catch(failed);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    try {
      expect(failed).not.toHaveBeenCalled();
    } finally {
      thread.resolve();
      await operation;
    }
    expect(failed).toHaveBeenCalledExactlyOnceWith(failure);
  });
});
