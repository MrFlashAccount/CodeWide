import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ScopedFileService } from "../src/index.js";

describe("scoped preview files", () => {
  let directory: string | undefined;
  let server: Server | undefined;
  let files: ScopedFileService | undefined;

  afterEach(async () => {
    if (server !== undefined) await new Promise<void>((resolve) => server?.close(() => resolve()));
    await files?.close();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    server = undefined;
    files = undefined;
    directory = undefined;
  });

  it("keeps exact outside-cwd image authorization across companion restarts", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "codewide-preview-registry-"));
    const observed = path.join(directory, "attached.png");
    const sibling = path.join(directory, "private.png");
    const registryPath = path.join(directory, "state", "preview-files.json");
    await writeFile(observed, "observed", "utf8");
    await writeFile(sibling, "private", "utf8");

    files = await ScopedFileService.create({ capabilityToken: "token", previewRegistryPath: registryPath });
    files.registerPreviewFilesFromAppServer("item/completed", {
      item: { type: "imageView", path: observed },
    });
    await files.close();
    files = await ScopedFileService.create({ capabilityToken: "token", previewRegistryPath: registryPath });

    server = createServer((request, response) => {
      void files?.handle(request, response).then((handled) => {
        if (!handled) response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const base = `http://127.0.0.1:${address.port}/v1/files/preview?path=`;
    const headers = { authorization: "Bearer token" };

    const restored = await fetch(`${base}${encodeURIComponent(observed)}`, { headers });
    expect(restored.status).toBe(200);
    expect(await restored.text()).toBe("observed");
    expect((await fetch(`${base}${encodeURIComponent(sibling)}`, { headers })).status).toBe(403);
  });

  it("reads an exact observed image through a PrivateTmp bind-mount mapping", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "codewide-preview-mapping-"));
    const readableTmp = path.join(directory, "host-tmp");
    const observed = path.join(readableTmp, "render.png");
    const sibling = path.join(readableTmp, "private.png");
    await mkdir(readableTmp);
    await writeFile(observed, "observed", "utf8");
    await writeFile(sibling, "private", "utf8");

    files = await ScopedFileService.create({
      capabilityToken: "token",
      previewPathMappings: { "/tmp": readableTmp },
    });
    files.registerPreviewFilesFromAppServer("item/completed", {
      item: { type: "imageView", path: "/tmp/render.png" },
    });

    server = createServer((request, response) => {
      void files?.handle(request, response).then((handled) => {
        if (!handled) response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const base = `http://127.0.0.1:${address.port}/v1/files/preview?path=`;
    const headers = { authorization: "Bearer token" };

    const preview = await fetch(`${base}${encodeURIComponent("/tmp/render.png")}`, { headers });
    expect(preview.status).toBe(200);
    expect(await preview.text()).toBe("observed");
    expect((await fetch(`${base}${encodeURIComponent("/tmp/private.png")}`, { headers })).status).toBe(403);
  });

  it("authorizes exact files projected by the thread resources endpoint", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "codewide-thread-resources-"));
    const changed = path.join(directory, "changed.ts");
    const attached = path.join(directory, "attached.md");
    const sibling = path.join(directory, "secret.txt");
    await Promise.all([
      writeFile(changed, "export const changed = true;", "utf8"),
      writeFile(attached, "# Attached", "utf8"),
      writeFile(sibling, "not observed", "utf8"),
    ]);
    files = await ScopedFileService.create({ capabilityToken: "token" });
    files.registerPreviewFilesFromAppServer("companion/threadResources/read", {
      threadId: "thread",
      changes: [{ path: changed }],
      attachments: [{ path: attached }],
    }, { threadId: "thread" });

    server = createServer((request, response) => {
      void files?.handle(request, response).then((handled) => {
        if (!handled) response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const base = `http://127.0.0.1:${address.port}/v1/files/preview?path=`;
    const headers = { authorization: "Bearer token" };

    expect((await fetch(`${base}${encodeURIComponent(changed)}`, { headers })).status).toBe(200);
    const oversizedRange = await fetch(`${base}${encodeURIComponent(changed)}`, {
      headers: { ...headers, range: "bytes=0-2097151" },
    });
    const changedBytes = (await stat(changed)).size;
    expect(oversizedRange.status).toBe(206);
    expect(oversizedRange.headers.get("content-range")).toBe(`bytes 0-${changedBytes - 1}/${changedBytes}`);
    expect(await oversizedRange.text()).toBe("export const changed = true;");
    expect((await fetch(`${base}${encodeURIComponent(attached)}`, { headers })).status).toBe(200);
    expect((await fetch(`${base}${encodeURIComponent(sibling)}`, { headers })).status).toBe(403);
  });

  it("allows authenticated files from a read-only preview root only", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "codewide-preview-root-"));
    const previewDirectory = path.join(directory, "attachments");
    const observed = path.join(previewDirectory, "attached.png");
    const sibling = path.join(directory, "private.png");
    await mkdir(previewDirectory);
    await writeFile(observed, "observed", "utf8");
    await writeFile(sibling, "private", "utf8");
    files = await ScopedFileService.create({ capabilityToken: "token", previewRoots: [previewDirectory] });

    server = createServer((request, response) => {
      void files?.handle(request, response).then((handled) => {
        if (!handled) response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const base = `http://127.0.0.1:${address.port}/v1/files/preview?path=`;
    const headers = { authorization: "Bearer token" };

    expect((await fetch(`${base}${encodeURIComponent(observed)}`, { headers })).status).toBe(200);
    expect((await fetch(`${base}${encodeURIComponent(sibling)}`, { headers })).status).toBe(403);
    expect((await fetch(`${base}${encodeURIComponent(observed)}`)).status).toBe(401);
  });
});
