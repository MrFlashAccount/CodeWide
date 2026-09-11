import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import type { CommandOutputReference } from "@codewide/sync-client";

import { commandOutputRevision, readCommandOutput } from "../src/rendering/command-output-resource";

function reference(text: string): CommandOutputReference {
  return { id: createHash("sha256").update(text).digest("hex"), byteLength: Buffer.byteLength(text),
    contentType: "text/plain; charset=utf-8", encoding: "utf-8" };
}

describe("lazy command output", () => {
  it("reads only the requested range, caches immutable bytes, and preserves repeated output", async () => {
    const first = reference("first\n");
    const second = reference("second\n");
    const bodies = new Map([[first.id, "first\n"], [second.id, "second\n"]]);
    const requests: string[] = [];
    const server = createServer((request, response) => {
      const id = request.url?.split("/").at(-1) ?? "";
      const body = bodies.get(id);
      if (body === undefined) { response.writeHead(404).end(); return; }
      requests.push(id);
      const range = /bytes=(\d+)-(\d+)/.exec(request.headers.range ?? "");
      const start = Number(range?.[1] ?? 0);
      const end = Math.min(body.length, Number(range?.[2] ?? body.length - 1) + 1);
      response.writeHead(206, { "content-type": "text/plain; charset=utf-8", "content-range": `bytes ${start}-${end - 1}/${body.length}` });
      response.end(body.slice(start, end));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Test listener has no TCP address");
    const getTransferAccess = async () => ({ baseUrl: `http://127.0.0.1:${address.port}`, authorization: "test" });
    const request = { scope: crypto.randomUUID(), references: [first], byteLimit: 64 * 1024, getTransferAccess };
    // React Native installs abort-controller 3: it supports cancellation but
    // does not implement the newer throwIfAborted convenience method.
    const signal = new AbortController().signal;
    Object.defineProperty(signal, "throwIfAborted", { value: undefined });
    try {
      expect(requests).toEqual([]);
      expect(await readCommandOutput(request, signal)).toEqual({ text: "first\n", hasMore: false });
      const live = { ...request, references: [first, second, second] };
      expect(await readCommandOutput(live, new AbortController().signal)).toEqual({ text: "first\nsecond\nsecond\n", hasMore: false });
      expect(requests).toEqual([first.id, second.id]);
      expect(await readCommandOutput(live, new AbortController().signal)).toEqual({ text: "first\nsecond\nsecond\n", hasMore: false });
      expect(requests).toEqual([first.id, second.id]);
      expect(await readCommandOutput({ ...live, byteLimit: 3 }, new AbortController().signal)).toEqual({ text: "fir", hasMore: true });
      const cancelledDuringRead = new AbortController();
      Object.defineProperty(cancelledDuringRead.signal, "throwIfAborted", { value: undefined });
      await expect(readCommandOutput({
        ...request,
        scope: crypto.randomUUID(),
        getTransferAccess: async () => {
          cancelledDuringRead.abort();
          return await getTransferAccess();
        },
      }, cancelledDuringRead.signal)).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it("rejects cancellation without requiring throwIfAborted or starting a transfer", async () => {
    const controller = new AbortController();
    Object.defineProperty(controller.signal, "throwIfAborted", { value: undefined });
    controller.abort();
    let transfers = 0;
    await expect(readCommandOutput({
      scope: "cancelled-output",
      references: [reference("cancelled")],
      byteLimit: 1024,
      getTransferAccess: async () => { transfers += 1; return { baseUrl: "http://unused.invalid", authorization: "test" }; },
    }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(transfers).toBe(0);
  });

  it("does not reload the visible prefix for output beyond its boundary", () => {
    const first = reference("12345");
    const second = reference("6789");
    expect(commandOutputRevision([first], 3)).toBe(commandOutputRevision([first, second], 3));
    expect(commandOutputRevision([first], 5)).not.toBe(commandOutputRevision([first, second], 5));
    expect(commandOutputRevision([first], 10)).not.toBe(commandOutputRevision([first, second], 10));
  });
});
