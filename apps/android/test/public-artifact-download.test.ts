import { createHash } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import { readPublicArtifact } from "../../../scripts/read-public-artifact";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
          server.closeAllConnections();
        }),
    ),
  );
});

async function serve(send: (response: ServerResponse) => void): Promise<URL> {
  const server = createServer((_request, response) => send(response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing test server port");
  return new URL(`http://127.0.0.1:${address.port}/artifact`);
}

function truncate(response: ServerResponse): void {
  response.writeHead(200, { "content-length": "100", connection: "close" });
  response.write("partial transfer");
  setTimeout(() => response.socket?.resetAndDestroy(), 10);
}

it("restarts a truncated transfer and hashes only the complete decoded artifact", async () => {
  const artifact = Buffer.from("complete artifact contents");
  let attempts = 0;
  const url = await serve((response) => {
    attempts += 1;
    if (attempts === 1) {
      truncate(response);
      return;
    }
    response.writeHead(200, { "content-encoding": "gzip" });
    response.end(gzipSync(artifact));
  });
  await expect(readPublicArtifact(url, { "accept-encoding": "gzip" })).resolves.toEqual({
    contentEncoding: "gzip",
    sha256: createHash("sha256").update(artifact).digest("hex"),
  });
  expect(attempts).toBe(2);
});

it("retries a body cut short of its declared length", async () => {
  const artifact = "complete artifact contents";
  let attempts = 0;
  const url = await serve((response) => {
    attempts += 1;
    if (attempts === 1) {
      response.writeHead(200, { "content-length": "100", connection: "close" });
      response.end("partial transfer");
      return;
    }
    response.end(artifact);
  });
  await expect(readPublicArtifact(url, {})).resolves.toEqual({
    contentEncoding: null,
    sha256: createHash("sha256").update(artifact).digest("hex"),
  });
  expect(attempts).toBe(2);
});

it("fails after three interrupted downloads instead of accepting a partial artifact", async () => {
  let attempts = 0;
  const url = await serve((response) => {
    attempts += 1;
    truncate(response);
  });
  await expect(readPublicArtifact(url, {})).rejects.toThrow();
  expect(attempts).toBe(3);
});

it("does not retry an HTTP failure", async () => {
  let attempts = 0;
  const url = await serve((response) => {
    attempts += 1;
    response.writeHead(503);
    response.end("unavailable");
  });
  await expect(readPublicArtifact(url, {})).rejects.toThrow("HTTP 503");
  expect(attempts).toBe(1);
});
