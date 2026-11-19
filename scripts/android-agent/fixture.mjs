// Only the upstream Codex App Server is synthetic. The Companion handles pairing,
// authenticated WebSocket delivery, the event journal and Android reconnection.
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const [upstreamSocket, controlSocket] = process.argv.slice(2);
const http = createServer();
const upstream = new WebSocketServer({ server: http });

upstream.on("connection", (peer) => {
  peer.on("message", (bytes) => {
    const { id, method } = JSON.parse(bytes.toString());
    if (id === undefined || !method) return;
    if (method === "initialize") {
      peer.send(
        JSON.stringify({
          id,
          result: { userAgent: "codex/test", platformFamily: "unix", platformOs: "linux" },
        }),
      );
    } else if (method === "thread/list" || method === "model/list") {
      peer.send(JSON.stringify({ id, result: { data: [], nextCursor: null } }));
    } else {
      peer.send(
        JSON.stringify({ id, error: { code: -32601, message: "Unsupported fixture method" } }),
      );
    }
  });
});
http.listen(upstreamSocket);

function eventFrames(kind, threadId) {
  const turnId = randomUUID();
  if (kind === "input") {
    return [
      {
        id: randomUUID(),
        method: "item/commandExecution/requestApproval",
        params: { threadId, turnId, itemId: randomUUID(), command: "echo fixture" },
      },
    ];
  }
  const failed = kind === "failure";
  return [
    {
      method: "thread/status/changed",
      params: { threadId, status: { type: "active", activeFlags: [] } },
    },
    {
      method: "turn/completed",
      params: {
        threadId,
        turn: {
          id: turnId,
          items: [],
          status: failed ? "failed" : "completed",
          error: failed ? { message: "Test failure" } : null,
        },
      },
    },
  ];
}

const events = createServer((req, res) => {
  const peers = [...upstream.clients].filter((peer) => peer.readyState === WebSocket.OPEN);
  if (peers.length === 0) {
    res.writeHead(503).end();
    return;
  }
  if (req.method === "GET" && req.url === "/ready") {
    res.end("ready");
    return;
  }
  if (req.method !== "POST" || !["/answer", "/failure", "/input"].includes(req.url)) {
    res.writeHead(404).end();
    return;
  }
  const threadId = randomUUID();
  for (const frame of eventFrames(req.url.slice(1), threadId)) {
    for (const peer of peers) peer.send(JSON.stringify(frame));
  }
  res.end(threadId);
});
events.listen(controlSocket);
