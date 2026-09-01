import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";

import { adb, type AndroidDevice } from "./androidDevice.ts";
import { delay } from "./process.ts";

const DURABLE_CREATE_LOG = "CodeWide Sync V2 durable operation committed";

export type CommandFaultStatus = {
  faultId: string;
  state:
    | "armed"
    | "nextCommandIntercepted"
    | "reinitializeSent"
    | "nextLiveHeld"
    | "released"
    | "timedOut";
  operationId?: string;
};

export async function armCommandFault(
  controlEndpoint: string,
  tokenFile: string,
): Promise<CommandFaultStatus> {
  return controlRequest(controlEndpoint, tokenFile, "POST", "/internal/e2e/v2-command-fault");
}

export async function releaseCommandFault(
  controlEndpoint: string,
  tokenFile: string,
  faultId: string,
): Promise<CommandFaultStatus> {
  return controlRequest(
    controlEndpoint,
    tokenFile,
    "POST",
    `/internal/e2e/v2-command-fault/${encodeURIComponent(faultId)}/release`,
  );
}

export async function waitForCommandFault(
  controlEndpoint: string,
  tokenFile: string,
  faultId: string,
  expected: CommandFaultStatus["state"],
  timeoutMs: number,
): Promise<CommandFaultStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await controlRequest(
      controlEndpoint,
      tokenFile,
      "GET",
      `/internal/e2e/v2-command-fault/${encodeURIComponent(faultId)}`,
    );
    if (status.state === expected) return status;
    if (status.state === "timedOut") throw new Error("Companion command fault timed out");
    await delay(50);
  }
  throw new Error(`Timed out waiting for Companion command fault state ${expected}`);
}

/** Observes the content-free native-store commit marker before polling Companion interception. */
export async function waitForClientDurableCreate(
  device: AndroidDevice,
  repoRoot: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const operationId = await readClientDurableCreate(device, repoRoot);
    if (operationId !== null) return operationId;
    await delay(50);
  }
  throw new Error("Android did not publish a durable Sync V2 operation commit");
}

export async function readClientDurableCreate(
  device: AndroidDevice,
  repoRoot: string,
): Promise<string | null> {
  const logcat = await adb(device, repoRoot, ["logcat", "-d", "-v", "brief"], {
    allowFailure: true,
    timeoutMs: 10_000,
  });
  return parseDurableCreateOperationId(logcat);
}

export function parseDurableCreateOperationId(logcat: string): string | null {
  const line = logcat.split("\n").findLast((candidate) => candidate.includes(DURABLE_CREATE_LOG));
  if (line === undefined) return null;
  const payloadStart = line.indexOf("{", line.indexOf(DURABLE_CREATE_LOG));
  if (payloadStart < 0) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(line.slice(payloadStart));
  } catch {
    return null;
  }
  return isRecord(payload) && typeof payload.operationId === "string" ? payload.operationId : null;
}

export async function waitForCompanionAdmission(
  logPath: string,
  checkpoint: number,
  operationId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const content = await readFile(logPath, "utf8");
    const current = content.slice(checkpoint);
    const matches = current
      .split("\n")
      .filter((line) => line.includes("Sync V2 command admission") && line.includes(operationId));
    if (matches.length === 1) return;
    if (matches.length > 1) {
      throw new Error(`Companion admitted operation ${operationId} more than once`);
    }
    await delay(100);
  }
  throw new Error(`Companion did not admit operation ${operationId}`);
}

export async function assertCompanionAdmissionCount(
  logPath: string,
  checkpoint: number,
  operationId: string,
  expected: number,
): Promise<void> {
  const content = await readFile(logPath, "utf8");
  const matches = content
    .slice(checkpoint)
    .split("\n")
    .filter((line) => line.includes("Sync V2 command admission") && line.includes(operationId));
  if (matches.length !== expected) {
    throw new Error(
      `Expected ${expected} final Companion admission for ${operationId}, found ${matches.length}`,
    );
  }
}

async function controlRequest(
  controlEndpoint: string,
  tokenFile: string,
  method: "GET" | "POST",
  requestPath: string,
): Promise<CommandFaultStatus> {
  const token = (await readFile(tokenFile, "utf8")).trim();
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        socketPath: controlEndpoint,
        path: requestPath,
        method,
        headers: { authorization: `Bearer ${token}` },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (
            response.statusCode === undefined ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            reject(
              new Error(
                `Companion private control returned ${response.statusCode ?? "unknown"}: ${body}`,
              ),
            );
            return;
          }
          try {
            resolve(parseCommandFaultStatus(JSON.parse(body)));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

function parseCommandFaultStatus(value: unknown): CommandFaultStatus {
  if (!isRecord(value) || typeof value.faultId !== "string" || typeof value.state !== "string") {
    throw new Error("Companion private control returned invalid fault status");
  }
  if (
    ![
      "armed",
      "nextCommandIntercepted",
      "reinitializeSent",
      "nextLiveHeld",
      "released",
      "timedOut",
    ].includes(value.state)
  ) {
    throw new Error("Companion private control returned unknown fault state");
  }
  const operationId = value.operationId;
  if (operationId !== undefined && typeof operationId !== "string") {
    throw new Error("Companion private control returned invalid operation id");
  }
  return {
    faultId: value.faultId,
    state: value.state as CommandFaultStatus["state"],
    ...(operationId === undefined ? {} : { operationId }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
