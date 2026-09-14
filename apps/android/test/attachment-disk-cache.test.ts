import { describe, expect, it } from "vitest";
import { AttachmentDiskCache, ATTACHMENT_CACHE_BYTES, type AttachmentStorage, type CachedAttachment } from "../src/native/attachment-cache/disk-cache";
import { attachmentMetadata, cachedResponseHeaders } from "../src/native/attachment-cache/http-metadata";

class Storage implements AttachmentStorage {
  readonly files = new Map<string, string>();
  readonly records = new Map<string, CachedAttachment>();
  async restore() { return [...this.records.values()]; }
  async exists(key: string, bytes: number) { return this.files.get(key)?.length === bytes; }
  async touch(entry: CachedAttachment) {
    // Capture the durable metadata snapshot, independent of subsequent in-memory touches.
    this.records.set(entry.key, { key: entry.key, bytes: entry.bytes, touchedAt: entry.touchedAt });
  }
  async remove(key: string) { this.files.delete(key); this.records.delete(key); }
  uri(key: string) { return `file:///cache/${key}`; }
}

function fixture(limit: number) {
  const storage = new Storage();
  let clock = 0;
  let downloads = 0;
  const cache = new AttachmentDiskCache(storage, () => ++clock, limit);
  return {
    storage, cache, downloads: () => downloads,
    load(key: string, body: string) {
      return cache.acquire(key, body.length, async () => { downloads += 1; storage.files.set(key, body); });
    },
  };
}

describe("attachment disk budget", () => {
  it("defaults to the declared one GiB budget", () => {
    expect(ATTACHMENT_CACHE_BYTES).toBe(1024 ** 3);
  });

  it("reopens cached bytes after restart without running the download", async () => {
    const f = fixture(12);
    (await f.load("document", "# Hello"))?.release();
    const restarted = new AttachmentDiskCache(f.storage, () => 10, 12);
    const lease = await restarted.acquire("document", 7, async () => { throw new Error("must use disk"); });
    expect(lease?.uri).toBe("file:///cache/document");
    expect(f.storage.files.get("document")).toBe("# Hello");
    lease?.release();
  });

  it("shares the budget across formats and evicts the least recently read file", async () => {
    const f = fixture(18);
    (await f.load("markdown", "# ABCD"))?.release();
    (await f.load("image", "PNG123"))?.release();
    (await f.load("markdown", "# ABCD"))?.release();
    (await f.load("html", "<p>x</p>"))?.release();
    expect(f.storage.files.has("image")).toBe(false);
    expect(f.storage.files.get("markdown")).toBe("# ABCD");
    expect(f.storage.files.get("html")).toBe("<p>x</p>");
    expect(f.downloads()).toBe(3);
  });

  it("keeps active readers and bypasses the cache when they occupy the budget", async () => {
    const f = fixture(10);
    const first = await f.load("image", "123456");
    const reader = f.cache.retain(first?.uri ?? "");
    first?.release();
    expect(await f.load("video", "123456")).toBeNull();
    expect(f.storage.files.get("image")).toBe("123456");
    reader();
    (await f.load("video", "123456"))?.release();
    expect(f.storage.files.has("image")).toBe(false);
    expect(f.storage.files.get("video")).toBe("123456");
  });

  it("deduplicates concurrent readers and reserves in-flight bytes", async () => {
    const f = fixture(10);
    const start = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let writes = 0;
    const write = async () => { writes += 1; start.resolve(); await finish.promise; f.storage.files.set("a", "123456"); };
    const first = f.cache.acquire("a", 6, write);
    await start.promise;
    const second = f.cache.acquire("a", 6, write);
    expect(await f.load("b", "123456")).toBeNull();
    finish.resolve();
    const leases = await Promise.all([first, second]);
    expect(writes).toBe(1);
    leases[0]?.release();
    expect(await f.load("b", "123456")).toBeNull();
    leases[1]?.release();
    (await f.load("b", "123456"))?.release();
    expect(f.storage.files.get("b")).toBe("123456");
  });

  it("does not retain failed writes and admits a retry", async () => {
    const f = fixture(6);
    await expect(f.cache.acquire("a", 6, async () => { f.storage.files.set("a", "12"); throw new Error("interrupted"); })).rejects.toThrow("interrupted");
    expect(f.storage.files.has("a")).toBe(false);
    (await f.load("a", "123456"))?.release();
    expect(f.storage.files.get("a")).toBe("123456");
  });

  it("recovers from OS eviction and bypasses oversized attachments", async () => {
    const f = fixture(6);
    (await f.load("a", "123456"))?.release();
    f.storage.files.delete("a");
    (await f.load("a", "123456"))?.release();
    expect(f.downloads()).toBe(2);
    expect(await f.load("large", "1234567")).toBeNull();
    expect(f.downloads()).toBe(2);
  });
});

describe("attachment freshness and byte ranges", () => {
  it("requires a revision and preserves UTF-8 byte range semantics", () => {
    const headers = new Headers({ "content-length": "50", "content-type": "text/markdown", "x-content-sha256": "a".repeat(64) });
    const metadata = attachmentMetadata(headers, "bytes=10-99");
    expect(metadata).toMatchObject({ bytes: 40, start: 10, totalBytes: 50 });
    if (metadata === null) throw new Error("missing metadata");
    expect(cachedResponseHeaders(metadata).get("content-range")).toBe("bytes 10-49/50");
    headers.delete("x-content-sha256");
    expect(attachmentMetadata(headers, null)).toBeNull();
    headers.set("etag", 'W/"weak"');
    expect(attachmentMetadata(headers, null)).toBeNull();
    headers.set("etag", '"strong"');
    expect(attachmentMetadata(headers, null)?.revision).toBe('"strong"');
  });

  it("preserves empty files and rejects malformed or unsatisfied ranges", () => {
    const headers = new Headers({ "content-length": "0", "x-content-sha256": "a".repeat(64) });
    expect(attachmentMetadata(headers, null)?.bytes).toBe(0);
    expect(attachmentMetadata(headers, "bytes=0-2")).toBeNull();
    headers.set("content-length", "10");
    expect(attachmentMetadata(headers, "bytes=5-2")).toBeNull();
  });
});

import { AttachmentResponse } from "../src/native/attachment-cache/attachment-response";

describe("cached response body contract", () => {
  it("decodes UTF-8 and lets a clone consume the same bytes independently", async () => {
    const body = new TextEncoder().encode('{"title":"Привет 👋"}').buffer;
    const response = new AttachmentResponse(body, { status: 200, headers: { "content-type": "application/json" } });
    const clone = response.clone();
    expect(await response.json()).toEqual({ title: "Привет 👋" });
    expect(response.bodyUsed).toBe(true);
    expect(() => response.clone()).toThrow();
    expect(await clone.text()).toBe('{"title":"Привет 👋"}');
    await expect(clone.text()).rejects.toThrow();
  });
});
