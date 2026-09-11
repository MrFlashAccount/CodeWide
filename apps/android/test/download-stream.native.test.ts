import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pickDownloadDirectory, startPreviewDownload } from "../src/native/file-transfer.native";

const storage = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  failWrite: false,
  writes: 0,
  open: vi.fn(() => { throw new Error("FileChannel must not be used for SAF downloads"); }),
}));

// WHY: Expo's SAF objects require Android. The real download adapter, HTTP
// range validation, cancellation, hashing and finalization run in this test.
vi.mock("expo-file-system", () => {
  class File {
    constructor(readonly uri: string) {}
    get name() { return this.uri.slice(this.uri.lastIndexOf("/") + 1); }
    get size() { return storage.files.get(this.uri)?.length ?? 0; }
    get exists() { return storage.files.has(this.uri); }
    open = storage.open;
    write(bytes: Uint8Array, options: { append: boolean }) {
      if (storage.failWrite) throw new Error("Storage write failed");
      if (!options.append) throw new Error("Resume must not truncate the partial file");
      const previous = storage.files.get(this.uri) ?? new Uint8Array();
      // Each completed write replaces provider bytes, retaining prior snapshots.
      const joined = new Uint8Array(previous.length + bytes.length);
      joined.set(previous);
      joined.set(bytes, previous.length);
      storage.files.set(this.uri, joined);
      storage.writes += 1;
    }
    delete() { storage.files.delete(this.uri); }
  }
  class Directory {
    static async pickDirectoryAsync() { return new Directory(); }
    name = "Downloads";
    list() { return [...storage.files.keys()].map((uri) => new File(uri)); }
    createFile(name: string) {
      const file = new File(`content://downloads/${name}`);
      storage.files.set(file.uri, new Uint8Array());
      return file;
    }
  }
  return { Directory, File, FileMode: {}, Paths: {} };
});

// WHY: React Native's ContentResolver bridge cannot execute in Node. It
// exposes the same byte-count/hash contract over the test storage provider.
vi.mock("react-native", async () => {
  const { createHash } = await import("node:crypto");
  function digest(uri: string) {
    const bytes = storage.files.get(uri);
    if (bytes === undefined) throw new Error("File not found");
    return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  return { Linking: {}, NativeModules: { CodeWideNative: {
    async hashContentDocument(uri: string) { return digest(uri); },
    async copyContentDocument(source: string, target: string) {
      const bytes = storage.files.get(source);
      if (bytes === undefined) throw new Error("File not found");
      storage.files.set(target, bytes);
      return digest(target);
    },
  } } };
});

const getAccess = async () => ({ baseUrl: "https://example.test", authorization: "test" });
const filename = "image.png";

function serve(bytes: Uint8Array, beforeBody: () => void = () => undefined, hashOverride?: string) {
  const hash = hashOverride ?? createHash("sha256").update(bytes).digest("hex");
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const headers = { "x-content-sha256": hash, "content-length": String(bytes.length), "content-type": "image/png" };
    if (init.method === "HEAD") return new Response(null, { headers });
    const range = new Headers(init.headers).get("range") ?? "";
    requests.push(range);
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (match === null) throw new Error("Missing range");
    const start = Number(match[1]);
    const end = Number(match[2]);
    beforeBody();
    return new Response(bytes.slice(start, end + 1), { status: 206, headers: {
      ...headers, "content-range": `bytes ${start}-${end}/${bytes.length}`,
    } });
  }));
  return { hash, requests, partialUri: `content://downloads/.codex-part-${hash.slice(0, 16)}-${filename}` };
}

beforeEach(() => { storage.files.clear(); storage.failWrite = false; storage.writes = 0; storage.open.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe("SAF streamed downloads", () => {
  it("resumes a partial file, appends multiple ranges and publishes verified bytes", async () => {
    const bytes = new Uint8Array(4 * 1024 * 1024 + 5).fill(37);
    const served = serve(bytes);
    storage.files.set(served.partialUri, bytes.slice(0, 2));
    const directory = await pickDownloadDirectory();
    const result = await startPreviewDownload(getAccess, directory, `/${filename}`, () => undefined).promise;
    expect(result).toMatchObject({ bytes: bytes.length, sha256: served.hash, uri: `content://downloads/${filename}` });
    expect(Buffer.from(storage.files.get(result.uri ?? "") ?? []).equals(bytes)).toBe(true);
    expect(storage.files.has(served.partialUri)).toBe(false);
    expect(served.requests).toEqual([`bytes=2-${4 * 1024 * 1024 + 1}`, `bytes=${4 * 1024 * 1024 + 2}-${bytes.length - 1}`]);
    expect(storage.writes).toBe(served.requests.length);
    expect(storage.open).not.toHaveBeenCalled();
  });

  it("does not append a response arriving after cancellation", async () => {
    let cancel: () => void = () => undefined;
    const served = serve(new Uint8Array([1, 2, 3]), () => cancel());
    const transfer = startPreviewDownload(getAccess, await pickDownloadDirectory(), `/${filename}`, () => undefined);
    cancel = transfer.cancel;
    await expect(transfer.promise).rejects.toThrow("Transfer cancelled");
    expect(storage.files.get(served.partialUri)).toHaveLength(0);
    expect(storage.writes).toBe(0);
  });

  it("preserves the partial file and original write error for retry", async () => {
    const served = serve(new Uint8Array([1, 2, 3]));
    storage.files.set(served.partialUri, new Uint8Array([1]));
    storage.failWrite = true;
    await expect(startPreviewDownload(getAccess, await pickDownloadDirectory(), `/${filename}`, () => undefined).promise)
      .rejects.toThrow("Storage write failed");
    expect(storage.files.get(served.partialUri)).toEqual(new Uint8Array([1]));
    expect(storage.files.has(`content://downloads/${filename}`)).toBe(false);
  });

  it("never publishes bytes that fail the final integrity check", async () => {
    serve(new Uint8Array([1, 2, 3]), () => undefined, "0".repeat(64));
    await expect(startPreviewDownload(getAccess, await pickDownloadDirectory(), `/${filename}`, () => undefined).promise)
      .rejects.toThrow("SHA-256 integrity verification");
    expect(storage.files.size).toBe(0);
  });
});
