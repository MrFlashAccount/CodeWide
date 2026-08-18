#!/usr/bin/env node

import { request } from "node:http";
import path from "node:path";

import { encodePairingLink, encodePairingPayload } from "@codewide/codex-protocol/pairing";
import * as qrcode from "qrcode-terminal";

import { startHostCompanion } from "./server.js";
import { resolveDefaultTokenPath } from "./state-paths.js";
import { createCapabilityToken, readCapabilityToken } from "./token.js";

const command = process.argv[2];
const jsonOnly = command === "pair" && process.argv.includes("--json");
const defaultTokenPath = resolveDefaultTokenPath(process.env.HOME ?? process.cwd());
const tokenPath = process.env.CODEWIDE_TOKEN_FILE ?? defaultTokenPath;
const host = process.env.CODEWIDE_HOST ?? "127.0.0.1";
const port = Number(process.env.CODEWIDE_PORT ?? "8765");
const controlEndpoint = process.env.CODEWIDE_CONTROL_ENDPOINT ?? defaultControlEndpoint();

if (command === "create-token") {
  await createCapabilityToken(tokenPath);
  process.stdout.write(`${JSON.stringify({ created: true, tokenPath })}\n`);
} else if (command === "serve") {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("Invalid CODEWIDE_PORT");
  const capabilityToken = await readCapabilityToken(tokenPath);
  const fileRoots = parseFileRoots(process.env.CODEWIDE_FILE_ROOTS);
  const previewRoots = parsePreviewRoots(process.env.CODEWIDE_PREVIEW_ROOTS);
  const previewPathMappings = parsePreviewPathMappings(process.env.CODEWIDE_PREVIEW_PATH_MAPPINGS);
  // v2 starts a clean replay epoch: v1 journals may contain pre-projection
  // multi-megabyte frames which must never be replayed into a new client.
  const replayJournalPath = process.env.CODEWIDE_REPLAY_JOURNAL ?? path.join(path.dirname(tokenPath), "replay-v2.jsonl");
  const companion = await startHostCompanion({
    host,
    port,
    capabilityToken,
    allowNonLoopback: process.env.CODEWIDE_ALLOW_NON_LOOPBACK === "1",
    fileRoots,
    previewRoots,
    previewPathMappings,
    replayJournalPath,
    queuePath: process.env.CODEWIDE_QUEUE_FILE ?? path.join(path.dirname(tokenPath), "queue.json"),
    deviceRegistryPath: process.env.CODEWIDE_DEVICE_REGISTRY ?? path.join(path.dirname(tokenPath), "devices.json"),
    ...(process.env.CODEWIDE_BUILD_SHELF_ORIGIN === undefined
      ? {}
      : { buildShelfOrigin: process.env.CODEWIDE_BUILD_SHELF_ORIGIN }),
  });
  process.stdout.write(`${JSON.stringify({ status: "listening", ...companion.address() })}\n`);
  const shutdown = async () => {
    await companion.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} else if (command === "pair" || command === "devices" || command === "revoke" || command === "scopes") {
  const capabilityToken = await readCapabilityToken(tokenPath);
  const deviceId = process.argv[3] ?? "";
  const action = command === "pair" ? "/v1/pairing/start" : command === "devices" ? "/v1/devices" : `/v1/devices/${encodeURIComponent(deviceId)}`;
  if ((command === "revoke" || command === "scopes") && deviceId === "") throw new Error("Device id is required");
  const scopes = command === "scopes" ? (process.argv[4] ?? "").split(",").map((scope) => scope.trim()).filter(Boolean) : undefined;
  if (command === "scopes" && scopes?.length === 0) throw new Error("Comma-separated scopes are required");
  const response = await requestControl(controlEndpoint, action, {
    method: command === "pair" ? "POST" : command === "revoke" ? "DELETE" : command === "scopes" ? "PATCH" : "GET",
    headers: {
      authorization: `Bearer ${capabilityToken}`,
      ...(command === "scopes" ? { "content-type": "application/json" } : {}),
    },
    ...(command === "scopes" ? { body: JSON.stringify({ scopes }) } : {}),
  });
  const body = response.body;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Companion returned ${response.status}: ${body.trim()}`);
  }
  if (command !== "pair") {
    process.stdout.write(body);
  } else {
    const pairing = JSON.parse(body) as { pairingToken: string; expiresAt: number };
    const endpoint = process.env.CODEWIDE_PUBLIC_ENDPOINT;
    if (endpoint === undefined) {
      process.stdout.write(body);
      if (!jsonOnly) process.stderr.write("Set CODEWIDE_PUBLIC_ENDPOINT to print a scannable pairing QR.\n");
    } else {
      const pairingInput = {
        type: "codewide-pairing",
        version: 1,
        endpoint,
        pairingToken: pairing.pairingToken,
        expiresAt: pairing.expiresAt,
        displayName: process.env.CODEWIDE_SERVER_NAME ?? "Codex server",
        emoji: process.env.CODEWIDE_SERVER_EMOJI ?? "🖥️",
        ...(process.env.CODEWIDE_TLS_PIN_SHA256 === undefined
          ? {}
          : { tlsPinSha256: process.env.CODEWIDE_TLS_PIN_SHA256 }),
      } as const;
      const pairingPayload = encodePairingPayload(pairingInput);
      const pairingLink = encodePairingLink(pairingInput);
      process.stdout.write(`${JSON.stringify({ ...pairing, endpoint, pairingPayload, pairingLink })}\n`);
      if (!jsonOnly) {
        process.stdout.write(`\nOpen on Android:\n${pairingLink}\n\n`);
        qrcode.generate(pairingLink, { small: true }, (code) => process.stdout.write(`${code}\n`));
      }
    }
  }
} else {
  process.stderr.write("Usage: codewide-host <create-token|serve|pair [--json]|devices|revoke DEVICE_ID|scopes DEVICE_ID SCOPE,...>\n");
  process.exitCode = 2;
}

function defaultControlEndpoint(): string {
  if (process.platform === "win32") return String.raw`\\.\pipe\codewide-companion-control`;
  const runtimeRoot = process.env.XDG_RUNTIME_DIR
    ?? process.env.XDG_STATE_HOME
    ?? path.join(process.env.HOME ?? process.cwd(), ".local", "state");
  return path.join(runtimeRoot, "codewide", "companion-control.sock");
}

async function requestControl(
  endpoint: string,
  requestPath: string,
  options: { method: string; headers: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const controlRequest = request({
      socketPath: endpoint,
      path: requestPath,
      method: options.method,
      headers: options.headers,
    }, (response) => {
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    controlRequest.on("error", (error) => {
      reject(new Error(`Cannot reach the running companion through ${endpoint}: ${error.message}`, { cause: error }));
    });
    if (options.body !== undefined) controlRequest.write(options.body);
    controlRequest.end();
  });
}

function parseFileRoots(value: string | undefined): Record<string, string> {
  if (value === undefined) return {};
  const parsed = JSON.parse(value) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CODEWIDE_FILE_ROOTS must be a JSON object");
  }
  const entries = Object.entries(parsed);
  if (entries.some(([, rootPath]) => typeof rootPath !== "string")) {
    throw new Error("CODEWIDE_FILE_ROOTS values must be absolute directory paths");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function parsePreviewRoots(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("CODEWIDE_PREVIEW_ROOTS must be a JSON array");
  if (!parsed.every((root): root is string => typeof root === "string" && path.isAbsolute(root))) {
    throw new Error("CODEWIDE_PREVIEW_ROOTS values must be absolute directory paths");
  }
  return parsed;
}

function parsePreviewPathMappings(value: string | undefined): Record<string, string> {
  if (value === undefined || value.trim() === "") return {};
  const parsed = JSON.parse(value) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CODEWIDE_PREVIEW_PATH_MAPPINGS must be a JSON object");
  }
  const entries = Object.entries(parsed);
  if (!entries.every(([reportedRoot, readableRoot]) => (
    path.isAbsolute(reportedRoot)
    && typeof readableRoot === "string"
    && path.isAbsolute(readableRoot)
  ))) {
    throw new Error("CODEWIDE_PREVIEW_PATH_MAPPINGS keys and values must be absolute directory paths");
  }
  return Object.fromEntries(entries) as Record<string, string>;
}
