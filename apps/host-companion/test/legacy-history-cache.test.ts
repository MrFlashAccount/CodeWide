import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { LegacyHistoryCache } from "../src/legacy-history-cache.js";

describe("LegacyHistoryCache", () => {
  let server: WebSocketServer | undefined;
  const directories: string[] = [];

  afterEach(async () => {
    const active = server;
    server = undefined;
    if (active !== undefined) await new Promise<void>((resolve) => active.close(() => resolve()));
    await Promise.all(directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })));
  });

  it("materializes a legacy rollout once, then serves pagination and activity by turn id", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    let reads = 0;
    server.on("connection", (socket) => socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (message.method === "thread/read") {
        reads += 1;
        socket.send(JSON.stringify({ id: message.id, result: { thread: { id: "thread", recencyAt: 7, turns: [
          turn("one", "question one", "answer one", "command one"),
          turn("two", "question two", "answer two", "command two"),
          turn("three", "question three", "answer three", "command three"),
        ] } } }));
      }
    }));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const cacheDirectory = await mkdtemp(path.join(tmpdir(), "codewide-history-cache-"));
    directories.push(cacheDirectory);
    const connectUpstream = () => new WebSocket(`ws://127.0.0.1:${address.port}`);
    const cache = new LegacyHistoryCache({ connectUpstream, cacheDirectory });

    const first = await cache.handle("client", "thread/turns/list", {
      threadId: "thread", cursor: null, limit: 2, sortDirection: "desc", itemsView: "summary", expectedRecencyAt: 7,
    }) as { data: Array<{ id: string; items: unknown[]; itemsView: string }>; nextCursor: string };
    expect(first.data.map(({ id }) => id)).toEqual(["three", "two"]);
    expect(first.data.every(({ items, itemsView }) => items.length === 2 && itemsView === "summary")).toBe(true);

    const second = await cache.handle("client", "thread/turns/list", {
      threadId: "thread", cursor: first.nextCursor, limit: 2, sortDirection: "desc", itemsView: "summary",
    }) as { data: Array<{ id: string }> };
    expect(second.data.map(({ id }) => id)).toEqual(["one"]);

    const activity = await cache.handle("client", "thread/items/list", {
      threadId: "thread", turnId: "two", cursor: null, limit: 100, sortDirection: "asc",
    }) as { data: Array<{ turnId: string; item: { type: string; text?: string } }> };
    expect(activity.data).toHaveLength(3);
    expect(activity.data[1]).toMatchObject({ turnId: "two", item: { type: "commandExecution", text: "command two" } });
    expect(reads).toBe(1);
    await cache.flush();
    expect((await readdir(cacheDirectory)).filter((name) => name.endsWith(".json.gz"))).toHaveLength(1);
    cache.close();
    const restored = new LegacyHistoryCache({ connectUpstream, cacheDirectory });
    const persistedPage = await restored.handle("client", "thread/turns/list", {
      threadId: "thread", cursor: null, limit: 2, sortDirection: "desc", itemsView: "summary", expectedRecencyAt: 7,
    }) as { data: Array<{ id: string }> };
    expect(persistedPage.data.map(({ id }) => id)).toEqual(["three", "two"]);
    expect(reads).toBe(1);

    await restored.handle("client", "thread/turns/list", {
      threadId: "thread", cursor: null, limit: 2, sortDirection: "desc", itemsView: "summary", expectedRecencyAt: 8,
    });
    expect(reads).toBe(2);
    await restored.flush();
    restored.close();
  });

  it("coalesces simultaneous cold requests", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    let reads = 0;
    server.on("connection", (socket) => socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (message.method === "thread/read") {
        reads += 1;
        setTimeout(() => socket.send(JSON.stringify({ id: message.id, result: { thread: { id: "thread", turns: [turn("one", "q", "a", "c")] } } })), 20);
      }
    }));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const cache = new LegacyHistoryCache({ connectUpstream: () => new WebSocket(`ws://127.0.0.1:${address.port}`) });

    await Promise.all([
      cache.handle("one", "thread/turns/list", { threadId: "thread" }),
      cache.handle("two", "thread/items/list", { threadId: "thread", turnId: "one" }),
    ]);
    expect(reads).toBe(1);
    cache.close();
  });

  it("projects all thread changes and attachments from the host history index", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    server.on("connection", (socket) => socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (message.method === "thread/read") socket.send(JSON.stringify({
        id: message.id,
        result: { thread: { id: "thread", cwd: "/workspace/project", turns: [{
          ...turn("one", "q", "a", "c"),
          items: [
            { type: "userMessage", id: "user", content: [
              { type: "text", text: "# Files mentioned by the user:\n\n## design.md: /outside/design.md\n\n## My request for Codex:\nPlease review it" },
              { type: "mention", name: "notes.md", path: "/workspace/notes.md" },
              { type: "localImage", path: "/tmp/photo.png" },
              { type: "skill", name: "ignored", path: "/skills/ignored" },
            ] },
            { type: "fileChange", id: "edit-one", changes: [
              { path: "src/a.ts", kind: { type: "update", move_path: null }, diff: "--- a\n+++ b\n-old\n+new\n" },
            ], status: "completed" },
            { type: "agentMessage", id: "agent", text: "done" },
          ],
        }, {
          ...turn("two", "q2", "a2", "c2"),
          items: [
            { type: "fileChange", id: "edit-two", changes: [
              { path: "src/a.ts", kind: { type: "update", move_path: null }, diff: "+again\n" },
              { path: "src/b.ts", kind: { type: "add" }, diff: "+created\n" },
              { path: "src/old.ts", kind: { type: "update", move_path: "src/new.ts" }, diff: "-old\n+new\n" },
            ], status: "completed" },
            { type: "imageView", id: "view", path: "/workspace/result.png" },
          ],
        }] } },
      }));
    }));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const cache = new LegacyHistoryCache({ connectUpstream: () => new WebSocket(`ws://127.0.0.1:${address.port}`) });

    const resources = await cache.handle("client", "companion/threadResources/read", { threadId: "thread" }) as {
      changes: Array<{ path: string; additions: number; deletions: number }>;
      attachments: Array<{ name: string; origin: string }>;
    };

    expect(resources.changes).toEqual([
      expect.objectContaining({ path: "/workspace/project/src/a.ts", additions: 2, deletions: 1 }),
      expect.objectContaining({ path: "/workspace/project/src/b.ts", additions: 1, deletions: 0 }),
      expect.objectContaining({ path: "/workspace/project/src/new.ts", additions: 1, deletions: 1 }),
    ]);
    expect(resources.attachments).toEqual([
      expect.objectContaining({ name: "design.md", origin: "user" }),
      expect.objectContaining({ name: "notes.md", origin: "user" }),
      expect.objectContaining({ name: "photo.png", origin: "user" }),
      expect.objectContaining({ name: "result.png", origin: "agent" }),
    ]);
    const diff = await cache.handle("client", "companion/threadChange/read", {
      threadId: "thread",
      path: "/workspace/project/src/a.ts",
    }) as { path: string; patches: Array<{ turnId: string; itemId: string; kind: string; diff: string }>; truncated: boolean };
    expect(diff).toEqual({
      threadId: "thread",
      path: "/workspace/project/src/a.ts",
      truncated: false,
      patches: [
        { turnId: "one", itemId: "edit-one", kind: "update", diff: "--- a\n+++ b\n-old\n+new\n" },
        { turnId: "two", itemId: "edit-two", kind: "update", diff: "+again\n" },
      ],
    });
    cache.close();
  });

  it("reports the current availability of historical changed files", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "codewide-change-availability-"));
    directories.push(workspace);
    await mkdir(path.join(workspace, "src"));
    await writeFile(path.join(workspace, "src/live.ts"), "export const live = true;\n", "utf8");
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    server.on("connection", (socket) => socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (message.method === "thread/read") socket.send(JSON.stringify({
        id: message.id,
        result: { thread: { id: "thread", cwd: workspace, turns: [{
          ...turn("one", "q", "a", "c"),
          items: [{ type: "fileChange", id: "edit", changes: [
            { path: "src/live.ts", kind: { type: "update", move_path: null }, diff: "+live\n" },
            { path: "src/deleted.ts", kind: { type: "update", move_path: null }, diff: "-gone\n" },
          ], status: "completed" }],
        }] } },
      }));
    }));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const cache = new LegacyHistoryCache({ connectUpstream: () => new WebSocket(`ws://127.0.0.1:${address.port}`) });

    const first = await cache.handle("client", "companion/threadResources/read", { threadId: "thread" }) as {
      revision: string;
      changes: Array<{ path: string; availability: string }>;
    };
    expect(first.changes).toEqual([
      expect.objectContaining({ path: path.join(workspace, "src/deleted.ts"), availability: "deleted" }),
      expect.objectContaining({ path: path.join(workspace, "src/live.ts"), availability: "available" }),
    ]);

    await writeFile(path.join(workspace, "src/deleted.ts"), "export const restored = true;\n", "utf8");
    const second = await cache.handle("client", "companion/threadResources/read", { threadId: "thread" }) as typeof first;
    expect(second.changes[0]).toMatchObject({ availability: "available" });
    expect(second.revision).not.toBe(first.revision);
    cache.close();
  });

  it("applies observed completed turns without rebuilding a large legacy history", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    let reads = 0;
    server.on("connection", (socket) => socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (message.method === "thread/read") {
        reads += 1;
        socket.send(JSON.stringify({ id: message.id, result: { thread: { id: "thread", recencyAt: 1, turns: [turn("one", "q1", "a1", "c1")] } } }));
      }
    }));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const cache = new LegacyHistoryCache({ connectUpstream: () => new WebSocket(`ws://127.0.0.1:${address.port}`) });

    await cache.handle("client", "thread/turns/list", {
      threadId: "thread", cursor: null, limit: 2, sortDirection: "desc", itemsView: "summary", expectedRecencyAt: 1,
    });
    cache.observe("turn/completed", {
      threadId: "thread",
      turn: turn("two", "q2", "a2", "c2"),
    });
    const page = await cache.handle("client", "thread/turns/list", {
      threadId: "thread", cursor: null, limit: 2, sortDirection: "desc", itemsView: "summary", expectedRecencyAt: 2,
    }) as { data: Array<{ id: string; items: Array<{ type: string; text?: string }> }> };

    expect(reads).toBe(1);
    expect(page.data.map(({ id }) => id)).toEqual(["two", "one"]);
    expect(page.data[0]?.items.at(-1)).toMatchObject({ type: "agentMessage", text: "a2" });
    cache.close();
  });

  it("appends completed-turn resources and diffs without rereading history", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    let reads = 0;
    server.on("connection", (socket) => socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (message.method === "thread/read") {
        reads += 1;
        socket.send(JSON.stringify({ id: message.id, result: { thread: {
          id: "thread",
          cwd: "/workspace",
          recencyAt: 1,
          turns: [fileChangeTurn("one", "src/one.ts", "+one\n")],
        } } }));
      }
    }));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const cache = new LegacyHistoryCache({ connectUpstream: () => new WebSocket(`ws://127.0.0.1:${address.port}`) });

    await cache.handle("client", "companion/threadResources/read", { threadId: "thread", expectedRecencyAt: 1 });
    cache.observe("turn/completed", {
      threadId: "thread",
      turn: fileChangeTurn("two", "src/two.ts", "-old\n+two\n"),
    });
    const resources = await cache.handle("client", "companion/threadResources/read", {
      threadId: "thread",
      expectedRecencyAt: 2,
    }) as { changes: Array<{ path: string }> };
    const diff = await cache.handle("client", "companion/threadChange/read", {
      threadId: "thread",
      path: "/workspace/src/two.ts",
      expectedRecencyAt: 2,
    }) as { patches: Array<{ turnId: string; diff: string }> };

    expect(resources.changes.map(({ path: filePath }) => filePath)).toEqual([
      "/workspace/src/one.ts",
      "/workspace/src/two.ts",
    ]);
    expect(diff.patches).toEqual([expect.objectContaining({ turnId: "two", diff: "-old\n+two\n" })]);
    expect(reads).toBe(1);
    cache.close();
  });

  it("projects the mutable live tail without rebuilding or duplicating its completed turn", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    let reads = 0;
    server.on("connection", (socket) => socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (message.method === "thread/read") {
        reads += 1;
        socket.send(JSON.stringify({ id: message.id, result: { thread: {
          id: "thread", cwd: "/workspace", recencyAt: 1, turns: [fileChangeTurn("one", "src/one.ts", "+one\n")],
        } } }));
      }
    }));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const cache = new LegacyHistoryCache({ connectUpstream: () => new WebSocket(`ws://127.0.0.1:${address.port}`) });
    await cache.handle("client", "companion/threadResources/read", { threadId: "thread", expectedRecencyAt: 1 });

    cache.observe("turn/started", { threadId: "thread", turn: { id: "live", status: "inProgress", items: [] } });
    cache.observe("item/fileChange/patchUpdated", {
      threadId: "thread",
      turnId: "live",
      itemId: "live-change",
      changes: [{ path: "src/live.ts", kind: { type: "update", move_path: null }, diff: "+live\n" }],
    });
    const live = await cache.handle("client", "companion/threadResources/read", {
      threadId: "thread",
      expectedRecencyAt: 2,
    }) as { changes: Array<{ path: string; additions: number }> };
    expect(live.changes).toEqual([
      expect.objectContaining({ path: "/workspace/src/live.ts", additions: 1 }),
      expect.objectContaining({ path: "/workspace/src/one.ts", additions: 1 }),
    ]);
    expect(reads).toBe(1);

    cache.observe("turn/completed", {
      threadId: "thread",
      turn: fileChangeTurn("live", "src/live.ts", "+live\n"),
    });
    const completed = await cache.handle("client", "companion/threadResources/read", {
      threadId: "thread",
      expectedRecencyAt: 3,
    }) as { changes: Array<{ path: string; additions: number }> };
    expect(completed.changes.find(({ path: filePath }) => filePath.endsWith("/live.ts"))?.additions).toBe(1);
    expect(reads).toBe(1);
    cache.close();
  });

  it("restores resources immediately and repairs a recency gap off the request path", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    let reads = 0;
    server.on("connection", (socket) => socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (message.method === "thread/read") {
        reads += 1;
        const recencyAt = reads === 1 ? 1 : 2;
        const turns = reads === 1
          ? [fileChangeTurn("one", "src/one.ts", "+one\n")]
          : [fileChangeTurn("one", "src/one.ts", "+one\n"), fileChangeTurn("two", "src/two.ts", "+two\n")];
        setTimeout(() => socket.send(JSON.stringify({ id: message.id, result: { thread: {
          id: "thread", cwd: "/workspace", recencyAt, turns,
        } } })), reads === 1 ? 0 : 200);
      }
    }));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const cacheDirectory = await mkdtemp(path.join(tmpdir(), "codewide-resource-cache-"));
    directories.push(cacheDirectory);
    const connectUpstream = () => new WebSocket(`ws://127.0.0.1:${address.port}`);
    const cache = new LegacyHistoryCache({ connectUpstream, cacheDirectory });
    await cache.handle("client", "companion/threadResources/read", { threadId: "thread", expectedRecencyAt: 1 });
    await cache.flush();
    cache.close();

    const restored = new LegacyHistoryCache({ connectUpstream, cacheDirectory });
    const startedAt = performance.now();
    const stale = await restored.handle("client", "companion/threadResources/read", {
      threadId: "thread",
      expectedRecencyAt: 2,
    }) as { changes: Array<{ path: string }> };
    const elapsedMs = performance.now() - startedAt;
    expect(stale.changes.map(({ path: filePath }) => filePath)).toEqual(["/workspace/src/one.ts"]);
    expect(elapsedMs).toBeLessThan(100);

    await new Promise((resolve) => setTimeout(resolve, 250));
    const repaired = await restored.handle("client", "companion/threadResources/read", {
      threadId: "thread",
      expectedRecencyAt: 2,
    }) as { changes: Array<{ path: string }> };
    expect(repaired.changes.map(({ path: filePath }) => filePath)).toEqual([
      "/workspace/src/one.ts",
      "/workspace/src/two.ts",
    ]);
    expect(reads).toBe(2);
    restored.close();
  });

  it("keeps inline image blobs out of history and activity payloads", async () => {
    server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server?.once("listening", resolve));
    const imagePath = "/tmp/codewide-attachments/example/Photo 1.jpg";
    const inline = `data:image/jpeg;base64,${"A".repeat(256 * 1024)}`;
    server.on("connection", (socket) => socket.on("message", (data) => {
      const message = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (message.method === "initialize") socket.send(JSON.stringify({ id: message.id, result: {} }));
      if (message.method === "thread/read") socket.send(JSON.stringify({
        id: message.id,
        result: { thread: { id: "thread", turns: [{
          ...turn("image-turn", "ignored", "answer", "command"),
          items: [
            { type: "userMessage", id: "image-user", content: [
              { type: "text", text: `# Files mentioned by the user:\n\n## Photo 1.jpg: ${imagePath}\n\n## My request:\nShow it` },
              { type: "image", detail: "auto", url: inline },
            ] },
            { type: "agentMessage", id: "image-agent", text: "answer" },
          ],
        }] } },
      }));
    }));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing test address");
    const cache = new LegacyHistoryCache({ connectUpstream: () => new WebSocket(`ws://127.0.0.1:${address.port}`) });

    const page = await cache.handle("client", "thread/turns/list", {
      threadId: "thread", cursor: null, limit: 1, sortDirection: "desc", itemsView: "summary",
    }) as { data: Array<{ items: Array<{ type: string; content?: unknown[] }> }> };
    const serializedPage = JSON.stringify(page);
    expect(serializedPage.length).toBeLessThan(4_096);
    expect(page.data[0]?.items[0]).toMatchObject({
      type: "userMessage",
      content: expect.arrayContaining([expect.objectContaining({ type: "localImage", path: imagePath })]),
    });

    const activity = await cache.handle("client", "thread/items/list", {
      threadId: "thread", turnId: "image-turn", cursor: null, limit: 100, sortDirection: "asc",
    });
    expect(JSON.stringify(activity).length).toBeLessThan(4_096);
    cache.close();
  });
});

function turn(id: string, question: string, answer: string, command: string) {
  return {
    id,
    items: [
      { type: "userMessage", id: `${id}-user`, content: [{ type: "text", text: question }] },
      { type: "commandExecution", id: `${id}-command`, text: command },
      { type: "agentMessage", id: `${id}-agent`, text: answer },
    ],
    itemsView: "full",
    status: "completed",
    error: null,
    startedAt: 1,
    completedAt: 2,
    durationMs: 1_000,
  };
}

function fileChangeTurn(id: string, filePath: string, diff: string) {
  return {
    ...turn(id, `change ${filePath}`, "done", "edit"),
    items: [{
      type: "fileChange",
      id: `${id}-change`,
      changes: [{ path: filePath, kind: { type: "update", move_path: null }, diff }],
      status: "completed",
    }],
  };
}
