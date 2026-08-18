import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ContentProjector, MAX_PROJECTED_ITEM_BYTES, PrivateContentService } from "../src/index.js";

describe("large transcript content projection", () => {
  let service: PrivateContentService | undefined;
  let server: Server | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    if (server !== undefined) await new Promise<void>((resolve) => server?.close(() => resolve()));
    await service?.close();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    server = undefined;
    service = undefined;
    directory = undefined;
  });

  it("keeps messages, stdout, diffs and tool results below one timeline budget", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "codewide-content-"));
    service = new PrivateContentService(directory, (authorization) => authorization === "Bearer allowed");
    const projector = new ContentProjector(service);
    const huge = "абвгд".repeat(450_000);
    const items = [
      { id: "agent", type: "agentMessage", text: huge },
      { id: "command", type: "commandExecution", command: "build", aggregatedOutput: huge, status: "completed" },
      { id: "diff", type: "fileChange", changes: [{ path: "src/file.ts", kind: "update", diff: huge }], status: "completed" },
      { id: "tool", type: "mcpToolCall", server: "test", tool: "large", result: { nested: huge }, status: "completed" },
    ];
    const projected = items.map((item) => projector.projectItem(item));
    for (const item of projected) {
      expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(MAX_PROJECTED_ITEM_BYTES);
      expect(item.codewideContent).toBeTruthy();
      expect(JSON.stringify(item)).not.toContain(huge.slice(0, 100_000));
    }
    const commandMetadata = projected[1]?.codewideContent as { fields: Record<string, { contentType: string }> };
    expect(commandMetadata.fields["/aggregatedOutput"]?.contentType).toBe("text/x-ansi; charset=utf-8");

    server = createServer((request, response) => {
      void service?.handle(request, response).then((handled) => {
        if (!handled) response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const metadata = projected[0]?.codewideContent as { fields: Record<string, { id: string; byteLength: number }> };
    const reference = metadata.fields["/text"]!;
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/content/${reference.id}?offset=65536&limit=1024`, {
      headers: { authorization: "Bearer allowed" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.byteLength(await response.text())).toBeLessThanOrEqual(1_024);
    expect(reference.byteLength).toBe(Buffer.byteLength(huge));

    const denied = await fetch(`http://127.0.0.1:${address.port}/v1/content/${reference.id}`);
    expect(denied.status).toBe(401);
  });

  it("preserves object-form file change kinds when a large item is externalized", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "codewide-file-change-kind-"));
    service = new PrivateContentService(directory, () => true);
    const projector = new ContentProjector(service);
    const projected = projector.projectItem({
      id: "diff",
      type: "fileChange",
      changes: [
        { path: "src/added.ts", kind: { type: "add" }, diff: "x".repeat(MAX_PROJECTED_ITEM_BYTES * 2) },
        { path: "src/deleted.ts", kind: { type: "delete" }, diff: "old" },
        { path: "src/updated.ts", kind: { type: "update", move_path: "src/moved.ts" }, diff: "+new" },
      ],
      status: "completed",
    });

    expect(projected.changes).toEqual([
      expect.objectContaining({ kind: { type: "add" } }),
      expect.objectContaining({ kind: { type: "delete" } }),
      expect.objectContaining({ kind: { type: "update", move_path: "src/moved.ts" } }),
    ]);
  });

  it("moves inline tool images into private binary storage without truncating them as text", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "codewide-tool-image-"));
    service = new PrivateContentService(directory, (authorization) => authorization === "Bearer allowed");
    const projector = new ContentProjector(service);
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const projected = projector.projectItem({
      id: "tool-image",
      type: "dynamicToolCall",
      tool: "view_image",
      status: "completed",
      contentItems: [{ type: "inputImage", imageUrl: `data:image/png;base64,${png.toString("base64")}` }],
    });
    const item = (projected.contentItems as Array<Record<string, unknown>>)[0]!;
    const asset = item.codewideAsset as { version: number; id: string; byteLength: number; contentType: string };
    expect(item.imageUrl).toBe("");
    expect(asset).toMatchObject({ version: 1, byteLength: png.byteLength, contentType: "image/png" });
    expect(projected.codewideContent).toBeUndefined();

    server = createServer((request, response) => {
      void service?.handle(request, response).then((handled) => {
        if (!handled) response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/content/${asset.id}`, {
      headers: { authorization: "Bearer allowed" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });

  it("moves MCP base64 image results into the same private binary storage", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "codewide-mcp-image-"));
    service = new PrivateContentService(directory, () => true);
    const projector = new ContentProjector(service);
    const projected = projector.projectItem({
      id: "mcp-image",
      type: "mcpToolCall",
      server: "screenshots",
      tool: "capture",
      status: "completed",
      result: { content: [{ type: "image", data: Buffer.from("image bytes").toString("base64"), mimeType: "image/png" }] },
    });
    const result = projected.result as { content: Array<Record<string, unknown>> };
    expect(result.content[0]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      codewideAsset: { version: 1, byteLength: 11, contentType: "image/png" },
    });
    expect(result.content[0]?.data).toBeUndefined();
  });

  it("moves image-generation base64 into private storage before generic projection", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "codewide-generated-image-"));
    service = new PrivateContentService(directory, () => true);
    const projector = new ContentProjector(service);
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const projected = projector.projectItem({
      id: "generated-image",
      type: "imageGeneration",
      status: "completed",
      revisedPrompt: null,
      result: png.toString("base64"),
      savedPath: "/tmp/generated.png",
    });

    expect(projected.result).toBe("");
    expect(projected.codewideAsset).toMatchObject({
      version: 1,
      byteLength: png.byteLength,
      contentType: "image/png",
    });
    expect(projected.codewideContent).toBeUndefined();
  });

  it("keeps a compact activity index when a large completed turn becomes a summary", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "codewide-turn-summary-"));
    service = new PrivateContentService(directory, () => true);
    const projector = new ContentProjector(service);
    const turn = projector.projectTurn({
      id: "turn",
      status: "completed",
      itemsView: "full",
      items: [
        { id: "user", type: "userMessage", content: [{ type: "text", text: "run" }] },
        ...Array.from({ length: 12 }, (_, index) => ({
          id: `tool-${index}`,
          type: "commandExecution",
          command: `command-${index}`,
          aggregatedOutput: "x".repeat(12_000),
          status: "completed",
        })),
        { id: "agent", type: "agentMessage", text: "done" },
      ],
    });

    expect(turn.itemsView).toBe("summary");
    expect((turn.items as Array<{ type: string }>).map(({ type }) => type)).toEqual(["userMessage", "agentMessage"]);
    expect(turn.codewide).toMatchObject({
      activity: { count: 12, kinds: Array(12).fill("commandExecution") },
    });
  });
});
