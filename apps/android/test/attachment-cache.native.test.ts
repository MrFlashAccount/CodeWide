import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const environment = vi.hoisted(() => ({ directory: "", interrupt: false, downloads: 0 }));
environment.directory = pathToFileURL(await mkdtemp(join(tmpdir(), "attachment-cache-"))).href + "/";

// WHY: Expo requires Android. These adapters use real temporary files while exercising the real cache owner and HTTP policy.
vi.mock("expo-file-system/legacy", () => ({
  get cacheDirectory() { return environment.directory; },
  async makeDirectoryAsync(uri: string) { await mkdir(fileURLToPath(uri), { recursive: true }); },
  async readDirectoryAsync(uri: string) { return readdir(fileURLToPath(uri)); },
  async getInfoAsync(uri: string) {
    try { const info = await stat(fileURLToPath(uri)); return { exists: true, isDirectory: info.isDirectory(), size: info.size }; }
    catch { return { exists: false }; }
  },
  async deleteAsync(uri: string) { await rm(fileURLToPath(uri), { force: true, recursive: true }); },
  async moveAsync(input: { from: string; to: string }) { await rename(fileURLToPath(input.from), fileURLToPath(input.to)); },
  async readAsStringAsync(uri: string) { return readFile(fileURLToPath(uri), "utf8"); },
  async writeAsStringAsync(uri: string, body: string, options?: { encoding: string }) {
    await writeFile(fileURLToPath(uri), options?.encoding === "base64" ? Buffer.from(body, "base64") : body);
  },
  async downloadAsync(uri: string, target: string, options: { headers: Record<string, string> }) {
    environment.downloads += 1;
    const response = await fetch(uri, { headers: options.headers });
    await writeFile(fileURLToPath(target), Buffer.from(await response.arrayBuffer()));
    if (environment.interrupt) { environment.interrupt = false; throw new Error("connection reset"); }
    return { status: response.status, headers: Object.fromEntries(response.headers), uri: target };
  },
}));

// WHY: Expo File is a native host object; only its file read is substituted with the Node filesystem.
vi.mock("expo-file-system", () => ({ File: class {
  constructor(readonly uri: string) {}
  async arrayBuffer() { return Uint8Array.from(await readFile(fileURLToPath(this.uri))).buffer; }
} }));

// WHY: Expo Crypto is a native module; Node computes the same SHA-256 over the actual input.
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  async digestStringAsync(_algorithm: string, value: string) { return createHash("sha256").update(value).digest("hex"); },
}));

import {
  cacheInlineAttachment,
  cachedAttachmentFetch,
  cachedAttachmentSource,
  cachedAttachmentSourceFromResponse,
} from "../src/native/attachment-cache/cached-transfer.native";
import { ExpoAttachmentStorage } from "../src/native/attachment-cache/storage.native";

function server(initial: string) {
  let body = initial;
  let gets = 0;
  let heads = 0;
  let denied = false;
  const request = vi.fn(async (_uri: string, init?: RequestInit) => {
    if (denied) return new Response(null, { status: 403 });
    const bytes = Buffer.from(body);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const headers = new Headers({ "content-type": "text/plain", "content-length": String(bytes.length), "x-content-sha256": digest });
    if (init?.method === "HEAD") {
      heads += 1;
      return new Response(null, { headers });
    }
    gets += 1;
    const range = new Headers(init?.headers).get("range");
    if (range !== null) {
      const match = /^bytes=(\d+)-(\d+)$/u.exec(range);
      if (match === null) throw new Error("Invalid test range");
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]) + 1, bytes.length);
      headers.set("content-range", `bytes ${start}-${end - 1}/${bytes.length}`);
      headers.set("content-length", String(end - start));
      return new Response(bytes.subarray(start, end), { status: 206, headers });
    }
    return new Response(bytes, { headers });
  });
  vi.stubGlobal("fetch", request);
  return {
    update: (value: string) => { body = value; },
    deny: () => { denied = true; },
    gets: () => gets,
    heads: () => heads,
  };
}

afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => { await rm(fileURLToPath(environment.directory), { recursive: true, force: true }); });

describe("native attachment cache", () => {
  it("materializes transformed images on a cold cache with one GET and no HEAD probe", async () => {
    const remote = server("webp bytes");
    const source = await cachedAttachmentSourceFromResponse({
      headers: {},
      options: { identity: "content:image:preview", scope: "server" },
      uri: "https://example.test/image?variant=preview",
    });

    expect(await readFile(fileURLToPath(source.uri), "utf8")).toBe("webp bytes");
    expect(remote.heads()).toBe(0);
    expect(remote.gets()).toBe(1);
  });

  it("opens cached documents with the AbortController shipped by React Native", async () => {
    // Resolve React Native's real dependency instead of Node's newer DOM API.
    const require = createRequire(import.meta.url);
    const nativeRequire = createRequire(require.resolve("react-native"));
    vi.stubGlobal("AbortController", nativeRequire("abort-controller").AbortController);
    const controller = new AbortController();
    const body = "# Отчёт за 11 сентября\n\nТекст документа.";
    const remote = server(body);
    const options = { scope: "server", identity: "native-abort-report.md" };
    const init = { signal: controller.signal, headers: { range: "bytes=0-2097151" } };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await cachedAttachmentFetch("https://example.test/report.md", init, options);
      expect(response.status).toBe(206);
      expect(await response.text()).toBe(body);
    }
    expect(remote.gets()).toBe(1);
    controller.abort();
    await expect(cachedAttachmentFetch("https://example.test/report.md", init, options)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("retains native media until cancellation without requiring browser-only signal methods", async () => {
    const require = createRequire(import.meta.url);
    const nativeRequire = createRequire(require.resolve("react-native"));
    vi.stubGlobal("AbortController", nativeRequire("abort-controller").AbortController);
    const controller = new AbortController();
    const remote = server("image bytes");
    const options = { scope: "server", identity: "native-abort-image" };
    const source = await cachedAttachmentSource({
      headers: {},
      options,
      signal: controller.signal,
      uri: "https://example.test/image",
    });
    expect(await readFile(fileURLToPath(source.uri), "utf8")).toBe("image bytes");
    controller.abort();
    await expect(cachedAttachmentSource({
      headers: {},
      options,
      signal: controller.signal,
      uri: "https://example.test/image",
    })).rejects.toMatchObject({ name: "AbortError" });
    const reopened = await cachedAttachmentSource({
      headers: {},
      options,
      uri: "https://example.test/image",
    });
    expect(reopened.uri).toBe(source.uri);
    expect(remote.gets()).toBe(1);
  });

  it("reuses Markdown, text, HTML and arbitrary binary bytes and invalidates changed content", async () => {
    for (const [name, body] of [["report.md", "# Привет"], ["file.txt", "text"], ["index.html", "<p>Hello</p>"], ["data.bin", "\u0000\u0001bytes"]]) {
      if (name === undefined || body === undefined) throw new Error("Incomplete fixture");
      const remote = server(body);
      const options = { scope: "server", identity: name };
      const uri = `https://example.test/${name}`;
      expect(await (await cachedAttachmentFetch(uri, {}, options)).text()).toBe(body);
      expect(await (await cachedAttachmentFetch(uri, {}, options)).text()).toBe(body);
      expect(remote.gets()).toBe(1);
      remote.update(body + " changed");
      expect(await (await cachedAttachmentFetch(uri, {}, options)).text()).toBe(body + " changed");
      expect(remote.gets()).toBe(2);
    }
  });

  it("preserves cached byte ranges and never substitutes them for a full download", async () => {
    const remote = server("0123456789");
    const options = { scope: "server", identity: "range" };
    const init = { headers: { range: "bytes=2-5" } };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await cachedAttachmentFetch("https://example.test/range", init, options);
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
      expect(await response.text()).toBe("2345");
    }
    expect(remote.gets()).toBe(1);
    expect(await (await cachedAttachmentFetch("https://example.test/range", {}, options)).text()).toBe("0123456789");
    expect(remote.gets()).toBe(2);
  });

  it("isolates saved servers and reuses files across rotating local transport URLs", async () => {
    const remote = server("same");
    await cachedAttachmentFetch("https://example.test/old", {}, { scope: "one", identity: "file" });
    await cachedAttachmentFetch("https://example.test/new", {}, { scope: "one", identity: "file" });
    expect(remote.gets()).toBe(1);
    await cachedAttachmentFetch("https://example.test/new", {}, { scope: "two", identity: "file" });
    expect(remote.gets()).toBe(2);
    remote.deny();
    expect((await cachedAttachmentFetch("https://example.test/new", {}, { scope: "one", identity: "file" })).status).toBe(403);
  });

  it("does not publish an interrupted download and successfully retries", async () => {
    const remote = server("image bytes");
    const options = { scope: "server", identity: "interrupted" };
    environment.interrupt = true;
    await expect(cachedAttachmentSource({
      headers: {},
      options,
      uri: "https://example.test/image",
    })).rejects.toThrow("connection reset");
    const source = await cachedAttachmentSource({
      headers: {},
      options,
      uri: "https://example.test/image",
    });
    expect(await readFile(fileURLToPath(source.uri), "utf8")).toBe("image bytes");
    expect(remote.gets()).toBe(2);
    expect((await readdir(fileURLToPath(environment.directory + "codewide-attachments-v1/"))).some((name) => name.endsWith(".partial"))).toBe(false);
  });

  it("atomically stores inline bytes and restores valid metadata without storing URLs or credentials", async () => {
    const uri = await cacheInlineAttachment("data:image/png;base64,aGVsbG8=", "aGVsbG8=");
    expect(await readFile(fileURLToPath(uri), "utf8")).toBe("hello");
    const records = await new ExpoAttachmentStorage().restore();
    expect(records.some((record) => record.bytes === 5)).toBe(true);
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("https:");
    expect(serialized).not.toContain("Bearer");
  });
});
