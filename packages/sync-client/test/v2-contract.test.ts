import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  V2_CONTRACT_SHA256,
  V2_PROTOCOL_LIMITS,
  V2ProtocolValidationError,
  MemoryV2OperationStore,
  canonicalV2Json,
  fingerprintV2Command,
  parseV2TerminalServerRecord,
  parseV2VoiceServerRecord,
  parseV2ServerFrame,
  validateV2TerminalClientRecord,
  validateV2VoiceClientRecord,
  validateV2ClientFrame,
  validateV2ContractDefinition,
  v2SavedServerId,
} from "../src/v2/index.js";
import { setup, snapshot, thread, waitFor } from "./v2-fixtures.js";
import { makeLive, savedServerA } from "./v2-fixtures.js";

const MAX_TERMINAL_EXIT_CODE = 4_294_967_295;

describe("Sync V2 generated contract authority", () => {
  it("binds TypeScript runtime validation to the exact executable schema", () => {
    const source = readFileSync(
      new URL("../../../apps/companion/contract/v2.json", import.meta.url),
      "utf8",
    );
    const contract = JSON.parse(source) as { "x-codewide": { limits: unknown } };
    expect(V2_CONTRACT_SHA256).toBe(createHash("sha256").update(source).digest("hex"));
    expect(V2_PROTOCOL_LIMITS).toEqual(contract["x-codewide"].limits);
    expect(() => validateV2ContractDefinition("serverFrame", snapshot())).not.toThrow();
    expect(() => validateV2ContractDefinition("threadSummary", thread("thread"))).not.toThrow();
  });

  it("rejects omitted nullable keys, unknown fields, and illegal error pairs", () => {
    const omitted = snapshot() as unknown as Record<string, unknown>;
    delete omitted.currentThread;
    expect(() => validateV2ContractDefinition("serverFrame", omitted)).toThrow();

    const invalid = snapshot();
    invalid.catalog.active[0] = { ...invalid.catalog.active[0]!, leakedSourceField: true } as never;
    expect(() => parseV2ServerFrame(JSON.stringify(invalid))).toThrow(V2ProtocolValidationError);
    expect(() =>
      parseV2ServerFrame(
        JSON.stringify({
          type: "queryFailed",
          requestId: "request",
          error: { code: "notFound", recovery: "retry", message: "missing" },
        }),
      ),
    ).toThrow(V2ProtocolValidationError);
  });

  it("requires exact attachment display metadata on every queued item", () => {
    const item = {
      attachments: [{ id: "attachment-stable", name: "Release notes final.md" }],
      id: "queue-item",
      input: [{ attachmentId: "attachment-stable", kind: "attachment" }],
      lastError: null,
      position: "1",
      state: "queued",
      summary: "Release notes",
      threadId: "thread",
    };
    expect(() => validateV2ContractDefinition("queueItem", item)).not.toThrow();
    const missing = { ...item } as Partial<typeof item>;
    delete missing.attachments;
    expect(() => validateV2ContractDefinition("queueItem", missing)).toThrow();
  });

  it("requires a closed numeric source generation on every snapshot", () => {
    const missing = snapshot() as unknown as Record<string, unknown>;
    delete missing.sourceGeneration;
    expect(() => parseV2ServerFrame(JSON.stringify(missing))).toThrow(V2ProtocolValidationError);
    expect(() =>
      parseV2ServerFrame(
        JSON.stringify({ ...snapshot(), sourceGeneration: "epoch-1:sync-v2-revision:1" }),
      ),
    ).toThrow(V2ProtocolValidationError);
  });

  it("rejects extra outbound fields through the generated client schema", () => {
    expect(() =>
      validateV2ClientFrame({
        type: "command",
        requestId: "request",
        operationId: "operation",
        command: {
          kind: "thread.delete",
          threadId: "thread",
          sourceMethod: "thread/delete",
        } as never,
      }),
    ).toThrow(V2ProtocolValidationError);
  });

  it("carries authoritative detailed changes through the V2 query contract", () => {
    expect(() =>
      validateV2ContractDefinition("query", {
        kind: "thread.change",
        threadId: "thread",
        path: "src/main.ts",
        scope: "session",
      }),
    ).not.toThrow();
    expect(() =>
      parseV2ServerFrame(
        JSON.stringify({
          type: "queryCompleted",
          requestId: "request",
          result: {
            kind: "thread.change",
            threadId: "thread",
            path: "/workspace/src/main.ts",
            scope: "session",
            patches: [
              {
                turnId: "turn",
                itemId: "item",
                kind: "update",
                diff: "@@ -1 +1 @@\n-old\n+new",
              },
            ],
            source: null,
            truncated: false,
          },
        }),
      ),
    ).not.toThrow();
  });

  it("preserves ultra effort and structured granular approval without string coercion", () => {
    const settings = {
      model: "gpt-5.6",
      effort: "ultra",
      approvalPolicy: {
        granular: {
          sandboxApproval: true,
          rules: false,
          skillApproval: true,
          requestPermissions: false,
          mcpElicitations: true,
        },
      },
      sandbox: "workspaceWrite",
      personality: null,
    } as const;
    expect(() => validateV2ContractDefinition("threadSettings", settings)).not.toThrow();
    expect(() =>
      validateV2ContractDefinition("threadSettings", {
        ...settings,
        approvalPolicy: { granular: { sandboxApproval: true } },
      }),
    ).toThrow();
    for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]) {
      expect(() => validateV2ContractDefinition("effort", effort), effort).not.toThrow();
    }
  });

  it("keeps background-process inspection and termination closed and bounded", () => {
    expect(() =>
      validateV2ContractDefinition("query", {
        kind: "thread.processes",
        threadId: "thread",
        cursor: null,
        limit: 100,
      }),
    ).not.toThrow();
    expect(() =>
      validateV2ContractDefinition("queryResult", {
        kind: "thread.processes",
        threadId: "thread",
        processes: [
          {
            itemId: "item",
            processId: "process",
            command: "pnpm dev",
            cwd: "/workspace",
            osPid: "42",
            cpuPercent: 12.5,
            rssKiB: "4096",
          },
        ],
        nextCursor: null,
      }),
    ).not.toThrow();
    expect(() =>
      validateV2ContractDefinition("backgroundProcess", {
        itemId: "item",
        processId: "process",
        command: "pnpm dev",
        cwd: "/workspace",
        osPid: null,
        cpuPercent: null,
        rssKiB: null,
      }),
    ).not.toThrow();
    expect(() =>
      validateV2ContractDefinition("command", {
        kind: "process.terminate",
        threadId: "thread",
        processId: "process",
      }),
    ).not.toThrow();
    expect(() =>
      validateV2ContractDefinition("query", {
        kind: "thread.processes",
        threadId: "thread",
        cursor: null,
        limit: 101,
      }),
    ).toThrow();
  });

  it("keeps catalog search paginated, partitioned, and bounded", () => {
    expect(() =>
      validateV2ContractDefinition("query", {
        kind: "catalog.search",
        partition: "active",
        text: "indexed thread",
        cursor: null,
        limit: 100,
      }),
    ).not.toThrow();
    expect(() =>
      validateV2ContractDefinition("queryResult", {
        kind: "catalog.search",
        threads: [thread("matching-thread")],
        nextCursor: "opaque-next-page",
      }),
    ).not.toThrow();
    for (const invalid of [
      { kind: "catalog.search", partition: "active", text: "", cursor: null, limit: 1 },
      { kind: "catalog.search", partition: "all", text: "thread", cursor: null, limit: 1 },
      { kind: "catalog.search", partition: "archived", text: "thread", cursor: null, limit: 101 },
    ]) {
      expect(() => validateV2ContractDefinition("query", invalid)).toThrow();
    }
  });

  it("enforces schema-derived array and error-message bounds", () => {
    expect(() =>
      validateV2ContractDefinition("command", {
        kind: "turn.steer",
        threadId: "thread",
        turnId: "turn",
        input: Array.from({ length: 129 }, () => ({ kind: "text", text: "x" })),
      }),
    ).toThrow();
    expect(() =>
      parseV2ServerFrame(
        JSON.stringify({
          type: "queryFailed",
          requestId: "request",
          error: { code: "notFound", recovery: "requery", message: "x".repeat(129) },
        }),
      ),
    ).toThrow(V2ProtocolValidationError);
  });

  it("matches the shared cross-runtime integer and strict UTC timestamp boundaries", () => {
    const fixtures = JSON.parse(
      readFileSync(new URL("./fixtures/v2-validator-boundaries.json", import.meta.url), "utf8"),
    ) as Array<{
      name: string;
      definition: Parameters<typeof validateV2ContractDefinition>[0];
      json: string;
      valid: boolean;
    }>;
    for (const fixture of fixtures) {
      const validate = () =>
        validateV2ContractDefinition(fixture.definition, JSON.parse(fixture.json) as unknown);
      if (fixture.valid) expect(validate, fixture.name).not.toThrow();
      else expect(validate, fixture.name).toThrow();
    }
  });

  it("uses canonical JSON identity independent of object property insertion order", () => {
    const left = { kind: "turn.interrupt", threadId: "thread", turnId: "turn" } as const;
    const right = { turnId: "turn", kind: "turn.interrupt", threadId: "thread" } as const;
    expect(canonicalV2Json(left)).toBe(canonicalV2Json(right));
    expect(fingerprintV2Command(left)).toBe(fingerprintV2Command(right));
  });

  it("rejects sparse and non-JSON array slots before persistence or outbound serialization", async () => {
    const sparseInput = new Array(1) as Array<{ kind: "text"; text: string }>;
    expect(() => canonicalV2Json(sparseInput)).toThrow("sparse arrays");
    expect(() =>
      validateV2ClientFrame({
        type: "command",
        requestId: "request",
        operationId: "operation",
        command: { kind: "turn.steer", threadId: "thread", turnId: "turn", input: sparseInput },
      }),
    ).toThrow(V2ProtocolValidationError);
    expect(() => canonicalV2Json([undefined])).toThrow("only JSON values");

    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    const before = socket.sent.length;
    await expect(
      session.command("operation", {
        kind: "turn.steer",
        threadId: "thread",
        turnId: "turn",
        input: sparseInput,
      }),
    ).rejects.toThrow("Sync V2 command was not durably created");
    expect(await operations.get(savedServerA, "operation")).toBeNull();
    const sparseAnswers = new Array(1) as Array<{ questionId: string; answers: string[] }>;
    await expect(
      session.command("resolution-operation", {
        kind: "request.resolve",
        requestId: "pending",
        generation: "1",
        resolution: { kind: "userInput", answers: sparseAnswers },
      }),
    ).rejects.toThrow("Sync V2 command was not durably created");
    expect(await operations.get(savedServerA, "resolution-operation")).toBeNull();
    expect(socket.sent).toHaveLength(before);
    session.stop();
  });

  it("uses the stable opaque saved-server record id as the local partition key", () => {
    expect(v2SavedServerId("saved-server-a")).toBe("saved-server-a");
    expect(() => v2SavedServerId("")).toThrow();
    expect(() => v2SavedServerId("saved\nserver")).toThrow();
  });

  it("uses protocol close codes for malformed, binary, and unknown records", async () => {
    const malformed = setup();
    malformed.session.start();
    await waitFor(() => malformed.socket.listenerCount("open") > 0);
    malformed.socket.open();
    malformed.socket.emit("{");
    expect(malformed.socket.closes.at(-1)?.code).toBe(1007);

    const binary = setup();
    binary.session.start();
    await waitFor(() => binary.socket.listenerCount("open") > 0);
    binary.socket.open();
    binary.socket.emitBinary();
    expect(binary.socket.closes.at(-1)?.code).toBe(1003);

    const unknown = setup();
    unknown.session.start();
    await waitFor(() => unknown.socket.listenerCount("open") > 0);
    unknown.socket.open();
    unknown.socket.emit({ type: "pong", nonce: "n", extra: true });
    expect(unknown.socket.closes.at(-1)?.code).toBe(1008);
  });

  it("keeps Terminal records closed and bounded", () => {
    expect(
      validateV2TerminalClientRecord({
        type: "open",
        version: 2,
        sessionId: "terminal-session",
        threadId: "thread",
        generation: "1",
        cwd: null,
        cols: 120,
        rows: 40,
        offset: "0",
        create: true,
      }),
    ).toMatchObject({ type: "open", version: 2 });
    expect(
      parseV2TerminalServerRecord(
        JSON.stringify({
          type: "output",
          offset: "1",
          data: "YQ==",
        }),
      ),
    ).toMatchObject({ type: "output", offset: "1" });
    for (const exitCode of [0, MAX_TERMINAL_EXIT_CODE]) {
      expect(
        parseV2TerminalServerRecord(
          JSON.stringify({ type: "exited", offset: "1", exitCode, signal: null }),
        ),
      ).toMatchObject({ type: "exited", exitCode });
    }
    for (const exitCode of [-1, MAX_TERMINAL_EXIT_CODE + 1]) {
      expect(() =>
        parseV2TerminalServerRecord(
          JSON.stringify({ type: "exited", offset: "1", exitCode, signal: null }),
        ),
      ).toThrow(V2ProtocolValidationError);
    }
    expect(() =>
      validateV2TerminalClientRecord({ type: "input", data: "x".repeat(1_398_105) }),
    ).toThrow(V2ProtocolValidationError);
    expect(() =>
      parseV2TerminalServerRecord(
        JSON.stringify({
          type: "output",
          offset: "1",
          data: "YQ==",
          leakedLegacyField: true,
        }),
      ),
    ).toThrow(V2ProtocolValidationError);
  });

  it("keeps Voice batches closed, sequenced, and bounded", () => {
    expect(
      validateV2VoiceClientRecord({
        type: "start",
        version: 2,
        generation: "1",
        inputScope: { kind: "generic", id: "composer" },
        threadId: null,
        language: null,
      }),
    ).toMatchObject({ type: "start", version: 2 });
    expect(
      parseV2VoiceServerRecord(
        JSON.stringify({
          type: "ack",
          sessionId: "voice-session",
          sequence: "0",
        }),
      ),
    ).toMatchObject({ type: "ack", sequence: "0" });
    expect(() =>
      validateV2VoiceClientRecord({
        type: "batch",
        sessionId: "voice-session",
        sequence: "0",
        sampleRate: 48_000,
        numChannels: 1,
        samplesPerChannel: 1,
        data: "x".repeat(1_398_105),
      }),
    ).toThrow(V2ProtocolValidationError);
    expect(() =>
      parseV2VoiceServerRecord(
        JSON.stringify({
          type: "retry",
          sessionId: "voice-session",
          retryAfterMs: 10,
          content: "must not leak",
        }),
      ),
    ).toThrow(V2ProtocolValidationError);
  });

  it("keeps the entire V2 transport graph outside V1 and App Server wire modules", () => {
    const root = resolve(dirname(new URL(import.meta.url).pathname), "../src/v2");
    const files = collectRelativeGraph(resolve(root, "session.ts"));
    const source = [...files].map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/@codewide\/codex-protocol|app-server|\.\.\/types/u);
    expect([...files].map((file) => basename(file))).toContain("transport.ts");
  });
});

function collectRelativeGraph(entry: string, files = new Set<string>()): Set<string> {
  if (files.has(entry)) return files;
  files.add(entry);
  const source = readFileSync(entry, "utf8");
  for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/gu)) {
    const candidate = resolve(dirname(entry), match[1]!.replace(/\.js$/u, "") + ".ts");
    try {
      collectRelativeGraph(candidate, files);
    } catch {
      /* type-only barrel outside the V2 graph is absent by contract */
    }
  }
  return files;
}
