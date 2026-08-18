import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { WebSocket } from "ws";

type RpcObject = Record<string, unknown>;

class SyncClient {
  readonly #socket: WebSocket;
  readonly #inbox: RpcObject[] = [];
  readonly #waiters = new Set<() => void>();

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (data) => {
      this.#inbox.push(JSON.parse(data.toString("utf8")) as RpcObject);
      for (const waiter of this.#waiters) waiter();
    });
  }

  static async connect(url: string, token: string): Promise<SyncClient> {
    const socket = new WebSocket(url, {
      headers: { authorization: `Bearer ${token}` },
      perMessageDeflate: false,
    });
    const client = new SyncClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, cursor: null }));
    const hello = await client.take((message) => message.type === "hello");
    if (hello.protocolVersion !== 1 || typeof hello.headCursor !== "number") {
      throw new Error(`${url} returned an invalid hello: ${JSON.stringify(hello)}`);
    }
    await client.take((message) => message.type === "status");
    socket.send(JSON.stringify({ type: "snapshotApplied", cursor: hello.headCursor }));
    await client.take((message) => message.type === "caughtUp");
    return client;
  }

  async rpc(method: string, params: RpcObject): Promise<{ elapsedMs: number; response: RpcObject }> {
    const id = `${method}:${Math.random()}`;
    const started = performance.now();
    this.#socket.send(JSON.stringify({ type: "rpc", request: { id, method, params } }));
    const envelope = await this.take((message) => {
      if (message.type !== "rpc") return false;
      const response = asObject(message.response);
      return response?.id === id;
    });
    const response = asObject(envelope.response);
    if (response === null) throw new Error(`${method} returned an invalid envelope`);
    return { elapsedMs: performance.now() - started, response };
  }

  close(): void {
    this.#socket.close();
  }

  async take(predicate: (message: RpcObject) => boolean): Promise<RpcObject> {
    const existingIndex = this.#inbox.findIndex(predicate);
    if (existingIndex >= 0) return this.#inbox.splice(existingIndex, 1)[0] as RpcObject;
    return await new Promise<RpcObject>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#waiters.delete(check);
        reject(new Error(`Timed out; inbox=${JSON.stringify(this.#inbox.slice(-5))}`));
      }, Number(process.env.CODEX_COMPARE_TIMEOUT_MS ?? 180_000));
      const check = (): void => {
        const index = this.#inbox.findIndex(predicate);
        if (index < 0) return;
        clearTimeout(timeout);
        this.#waiters.delete(check);
        resolve(this.#inbox.splice(index, 1)[0] as RpcObject);
      };
      this.#waiters.add(check);
    });
  }
}

const asObject = (value: unknown): RpcObject | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as RpcObject : null;

const resultData = (response: RpcObject): unknown[] => {
  if ("error" in response) throw new Error(JSON.stringify(response.error));
  const result = asObject(response.result);
  return Array.isArray(result?.data) ? result.data : [];
};

const stableIds = (values: unknown[]): string[] => values
  .map(asObject)
  .filter((value): value is RpcObject => value !== null)
  .map((value) => String(value.id ?? value.model ?? value.name ?? value.path ?? ""))
  .sort();

const tokenPath = process.env.CODEWIDE_TOKEN_FILE
  ?? path.join(homedir(), ".codewide", "host.token");
const token = (await readFile(tokenPath, "utf8")).trim();
const node = await SyncClient.connect(process.env.CODEX_NODE_SYNC ?? "ws://127.0.0.1:8765/v1/sync", token);
const rust = await SyncClient.connect(process.env.CODEX_RUST_SYNC ?? "ws://127.0.0.1:8766/v1/sync", token);

try {
  const checks = [
    { method: "thread/list", params: { limit: 20, sortKey: "updated_at" } },
    { method: "model/list", params: {} },
    { method: "skills/list", params: {} },
    ...(process.env.CODEX_THREAD_ID === undefined ? [] : [{
      method: "thread/turns/list",
      params: {
        threadId: process.env.CODEX_THREAD_ID,
        cursor: null,
        limit: 12,
        sortDirection: "desc",
        itemsView: "summary",
      },
    }]),
  ];
  const comparisons = [];
  let firstNodeTurns: RpcObject | null = null;
  let firstRustTurns: RpcObject | null = null;
  for (const check of checks) {
    const nodeResult = await node.rpc(check.method, check.params);
    const rustResult = await rust.rpc(check.method, check.params);
    if (check.method === "thread/turns/list") {
      firstNodeTurns = asObject(nodeResult.response.result);
      firstRustTurns = asObject(rustResult.response.result);
    }
    const nodeIds = stableIds(resultData(nodeResult.response));
    const rustIds = stableIds(resultData(rustResult.response));
    const nodeSemantics = check.method === "thread/turns/list" ? turnSemantics(resultData(nodeResult.response)) : [];
    const rustSemantics = check.method === "thread/turns/list" ? turnSemantics(resultData(rustResult.response)) : [];
    const fullSemanticMatch = JSON.stringify(nodeSemantics) === JSON.stringify(rustSemantics);
    const stableNodeSemantics = nodeSemantics.filter(isTerminalTurn);
    const stableRustSemantics = rustSemantics.filter(isTerminalTurn);
    const stableSemanticMatch = JSON.stringify(stableNodeSemantics) === JSON.stringify(stableRustSemantics);
    const nodeLiveIds = liveTurnIds(nodeSemantics);
    const rustLiveIds = liveTurnIds(rustSemantics);
    const liveIdsMatch = JSON.stringify(nodeLiveIds) === JSON.stringify(rustLiveIds);
    const semanticMatch = stableSemanticMatch && liveIdsMatch;
    const mismatchIndex = stableSemanticMatch ? -1 : stableNodeSemantics.findIndex(
      (value, index) => JSON.stringify(value) !== JSON.stringify(stableRustSemantics[index]),
    );
    comparisons.push({
      method: check.method,
      match: JSON.stringify(nodeIds) === JSON.stringify(rustIds) && semanticMatch,
      semanticMatch,
      ...(check.method === "thread/turns/list" ? {
        fullSemanticMatch,
        liveSnapshotDrift: semanticMatch && !fullSemanticMatch,
      } : {}),
      ...(mismatchIndex < 0 ? {} : {
        semanticMismatch: { node: stableNodeSemantics[mismatchIndex], rust: stableRustSemantics[mismatchIndex] },
      }),
      count: rustIds.length,
      nodeMs: Number(nodeResult.elapsedMs.toFixed(2)),
      rustMs: Number(rustResult.elapsedMs.toFixed(2)),
    });
  }
  if (process.env.CODEX_THREAD_ID !== undefined && firstNodeTurns !== null && firstRustTurns !== null) {
    const params = {
      threadId: process.env.CODEX_THREAD_ID,
      limit: 12,
      sortDirection: "desc",
      itemsView: "summary",
    };
    if (firstNodeTurns.nextCursor !== null && firstRustTurns.nextCursor !== null) {
      const nodeResult = await node.rpc("thread/turns/list", { ...params, cursor: firstNodeTurns.nextCursor });
      const rustResult = await rust.rpc("thread/turns/list", { ...params, cursor: firstRustTurns.nextCursor });
      const nodeData = resultData(nodeResult.response);
      const rustData = resultData(rustResult.response);
      const nodeSemantics = turnSemantics(nodeData);
      const rustSemantics = turnSemantics(rustData);
      const idMatch = JSON.stringify(stableIds(nodeData)) === JSON.stringify(stableIds(rustData));
      const semanticMatch = JSON.stringify(nodeSemantics) === JSON.stringify(rustSemantics);
      const mismatchIndex = semanticMatch ? -1 : nodeSemantics.findIndex(
        (value, index) => JSON.stringify(value) !== JSON.stringify(rustSemantics[index]),
      );
      comparisons.push({
        method: "thread/turns/list:page2",
        match: idMatch && semanticMatch,
        idMatch,
        semanticMatch,
        ...(mismatchIndex < 0 ? {} : {
          semanticMismatch: { node: nodeSemantics[mismatchIndex], rust: rustSemantics[mismatchIndex] },
        }),
        ...(!idMatch ? { nodeIds: stableIds(nodeData), rustIds: stableIds(rustData) } : {}),
        count: rustData.length,
        nodeMs: Number(nodeResult.elapsedMs.toFixed(2)),
        rustMs: Number(rustResult.elapsedMs.toFixed(2)),
      });
    }

    const resourceParams = { threadId: process.env.CODEX_THREAD_ID };
    const nodeResources = await node.rpc("companion/threadResources/read", resourceParams);
    const rustResources = await rust.rpc("companion/threadResources/read", resourceParams);
    const nodeResourceSemantics = resourceSemantics(nodeResources.response);
    const rustResourceSemantics = resourceSemantics(rustResources.response);
    comparisons.push({
      method: "companion/threadResources/read",
      match: JSON.stringify(nodeResourceSemantics) === JSON.stringify(rustResourceSemantics),
      semanticMatch: JSON.stringify(nodeResourceSemantics) === JSON.stringify(rustResourceSemantics),
      count: rustResourceSemantics.changes.length + rustResourceSemantics.attachments.length,
      nodeMs: Number(nodeResources.elapsedMs.toFixed(2)),
      rustMs: Number(rustResources.elapsedMs.toFixed(2)),
      ...(JSON.stringify(nodeResourceSemantics) === JSON.stringify(rustResourceSemantics) ? {} : {
        resourceMismatch: {
          ...resourceMismatch(nodeResourceSemantics, rustResourceSemantics),
        },
      }),
    });
    if (process.env.CODEX_RESOURCE_PATH !== undefined) {
      const changeParams = { threadId: process.env.CODEX_THREAD_ID, path: process.env.CODEX_RESOURCE_PATH };
      const nodeChange = await node.rpc("companion/threadChange/read", changeParams);
      const rustChange = await rust.rpc("companion/threadChange/read", changeParams);
      comparisons.push({
        method: "companion/threadChange/read",
        match: JSON.stringify(changeSemantics(nodeChange.response)) === JSON.stringify(changeSemantics(rustChange.response)),
        semanticMatch: JSON.stringify(changeSemantics(nodeChange.response)) === JSON.stringify(changeSemantics(rustChange.response)),
        count: changeSemantics(rustChange.response).length,
        nodeMs: Number(nodeChange.elapsedMs.toFixed(2)),
        rustMs: Number(rustChange.elapsedMs.toFixed(2)),
        node: changeSemantics(nodeChange.response),
        rust: changeSemantics(rustChange.response),
      });
    }
  }
  const expectRustMutations = process.env.CODEX_EXPECT_RUST_MUTATIONS === "1";
  const mutationError = expectRustMutations
    ? null
    : asObject((await rust.rpc("thread/delete", { threadId: "must-not-run" })).response.error);
  const result = {
    status: comparisons.every((comparison) => comparison.match)
      && (expectRustMutations || mutationError?.code === -32010)
      ? "match"
      : "mismatch",
    comparisons,
    rustMutationMode: expectRustMutations ? "active" : "readOnly",
    shadowMutationRejected: expectRustMutations ? null : mutationError?.code === -32010,
  };
  console.log(JSON.stringify(result));
  if (result.status !== "match") process.exitCode = 1;
} finally {
  node.close();
  rust.close();
}

function turnSemantics(values: unknown[]): unknown[] {
  return values.map((value) => {
    const turn = asObject(value) ?? {};
    const items = Array.isArray(turn.items) ? turn.items.map(asObject).filter((item): item is RpcObject => item !== null) : [];
    const user = items.find((item) => item.type === "userMessage");
    const agent = items.findLast((item) => item.type === "agentMessage");
    const userContent = Array.isArray(user?.content) ? user.content.map(asObject).filter((item): item is RpcObject => item !== null) : [];
    const remote = asObject(turn.codewide);
    const activity = asObject(remote?.activity);
    return {
      id: turn.id,
      status: turn.status,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
      durationMs: turn.durationMs,
      userTextBytes: userContent
        .filter((item) => item.type === "text")
        .reduce((total, item) => total + (typeof item.text === "string" ? Buffer.byteLength(item.text) : 0), 0),
      agentTextBytes: typeof agent?.text === "string" ? Buffer.byteLength(agent.text) : 0,
      agentPhase: agent?.phase,
      activityCount: activity?.count ?? 0,
      activityKinds: activity?.kinds ?? [],
    };
  });
}

function isTerminalTurn(value: unknown): boolean {
  const status = asObject(value)?.status;
  return status !== "inProgress" && status !== "running";
}

function liveTurnIds(values: unknown[]): string[] {
  return values
    .map(asObject)
    .filter((value): value is RpcObject => value !== null && !isTerminalTurn(value))
    .map((value) => String(value.id ?? ""))
    .sort();
}

function resourceSemantics(response: RpcObject): { changes: unknown[]; attachments: unknown[] } {
  if ("error" in response) throw new Error(JSON.stringify(response.error));
  const result = asObject(response.result) ?? {};
  const changes = (Array.isArray(result.changes) ? result.changes : [])
    .map(asObject)
    .filter((value): value is RpcObject => value !== null)
    .map((value) => ({
      path: value.path,
      kind: value.kind,
      additions: value.additions,
      deletions: value.deletions,
      availability: value.availability,
    }))
    .sort((left, right) => String(left.path).localeCompare(String(right.path)));
  const attachments = (Array.isArray(result.attachments) ? result.attachments : [])
    .map(asObject)
    .filter((value): value is RpcObject => value !== null)
    .map((value) => ({
      key: value.key,
      name: value.name,
      kind: value.kind,
      origin: value.origin,
      path: value.path,
      url: value.url,
    }))
    .sort((left, right) => String(left.key).localeCompare(String(right.key)));
  return { changes, attachments };
}

function changeSemantics(response: RpcObject): unknown[] {
  if ("error" in response) throw new Error(JSON.stringify(response.error));
  const result = asObject(response.result) ?? {};
  return (Array.isArray(result.patches) ? result.patches : [])
    .map(asObject)
    .filter((value): value is RpcObject => value !== null)
    .map((value) => ({
      kind: value.kind,
      chars: typeof value.diff === "string" ? value.diff.length : 0,
      additions: typeof value.diff === "string" ? value.diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length : 0,
      deletions: typeof value.diff === "string" ? value.diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).length : 0,
    }));
}

function resourceMismatch(
  node: { changes: unknown[]; attachments: unknown[] },
  rust: { changes: unknown[]; attachments: unknown[] },
): RpcObject {
  const changeIndex = firstMismatch(node.changes, rust.changes);
  const attachmentIndex = firstMismatch(node.attachments, rust.attachments);
  const nodeAttachmentKeys = new Set(node.attachments.map((value) => String(asObject(value)?.key ?? "")));
  const rustAttachmentKeys = new Set(rust.attachments.map((value) => String(asObject(value)?.key ?? "")));
  const nodeChangesByPath = new Map(node.changes.map((value) => [String(asObject(value)?.path ?? ""), value]));
  const rustChangesByPath = new Map(rust.changes.map((value) => [String(asObject(value)?.path ?? ""), value]));
  const changedStats = [...nodeChangesByPath].flatMap(([path, value]) => {
    const rustValue = rustChangesByPath.get(path);
    return rustValue !== undefined && JSON.stringify(value) !== JSON.stringify(rustValue)
      ? [{ path, node: value, rust: rustValue }]
      : [];
  });
  return {
    nodeChangeCount: node.changes.length,
    rustChangeCount: rust.changes.length,
    nodeAttachmentCount: node.attachments.length,
    rustAttachmentCount: rust.attachments.length,
    changePathsOnlyInNode: [...nodeChangesByPath.keys()].filter((path) => !rustChangesByPath.has(path)).slice(0, 30),
    changePathsOnlyInRust: [...rustChangesByPath.keys()].filter((path) => !nodeChangesByPath.has(path)).slice(0, 30),
    changedStats: changedStats.slice(0, 30),
    ...(changeIndex < 0 ? {} : {
      firstChange: { index: changeIndex, node: node.changes[changeIndex], rust: rust.changes[changeIndex] },
    }),
    ...(attachmentIndex < 0 ? {} : {
      firstAttachment: { index: attachmentIndex, node: node.attachments[attachmentIndex], rust: rust.attachments[attachmentIndex] },
      attachmentKeysOnlyInNode: [...nodeAttachmentKeys].filter((key) => !rustAttachmentKeys.has(key)).slice(0, 10),
      attachmentKeysOnlyInRust: [...rustAttachmentKeys].filter((key) => !nodeAttachmentKeys.has(key)).slice(0, 10),
    }),
  };
}

function firstMismatch(left: unknown[], right: unknown[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (JSON.stringify(left[index]) !== JSON.stringify(right[index])) return index;
  }
  return -1;
}
