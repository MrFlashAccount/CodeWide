import { fromByteArray, toByteArray } from "base64-js";
import {
  parseV2TerminalServerRecord,
  validateV2TerminalClientRecord,
} from "@codewide/sync-client/v2";

import type { TerminalTransport } from "../../application/ports/terminalTransport";
import { acquireSharedConnectionLease } from "../connection/sharedConnectionAdapter.native";
import { TerminalUtf8Decoder } from "./terminalUtf8Decoder";

export function createClosedTerminalTransport(sessionId: () => string): TerminalTransport {
  return {
    createSessionId: sessionId,
    async open(input, listener) {
      const connection = await acquireSharedConnectionLease(input.owner.savedServerId);
      const channel = connection.lease.openDuplex("terminal-v2");
      let decoder = new TerminalUtf8Decoder(input.offset);
      let finished = false;
      let released = false;
      const release = async (): Promise<void> => {
        if (released) return;
        released = true;
        await connection.lease.release();
      };
      const disconnect = (): void => {
        if (finished) return;
        finished = true;
        channel.close(1000, "terminal_detached");
        release().catch(() => undefined);
      };
      channel.addEventListener("open", () => {
        channel.send(
          JSON.stringify(
            validateV2TerminalClientRecord({
              cols: input.cols,
              create: input.create,
              cwd: input.cwd,
              generation: input.generation,
              offset: input.offset,
              rows: input.rows,
              sessionId: input.sessionId,
              threadId: input.owner.threadId,
              type: "open",
              version: 2,
            }),
          ),
        );
      });
      channel.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        try {
          const record = parseV2TerminalServerRecord(event.data);
          if (record.type === "opened") {
            if (record.sessionId !== input.sessionId || record.generation !== input.generation)
              throw new Error("Terminal opened with the wrong authority");
            decoder = new TerminalUtf8Decoder(record.offset);
            listener({ offset: record.offset, type: "opened" });
          } else if (record.type === "output") {
            const bytes = toByteArray(record.data);
            const decoded = decoder.push(record.offset, bytes);
            if (decoded !== null) listener({ ...decoded, type: "output" });
          } else if (record.type === "exited") {
            finished = true;
            const decoded = decoder.finish(record.offset);
            if (decoded !== null) listener({ ...decoded, type: "output" });
            listener({
              exitCode: record.exitCode,
              offset: record.offset,
              signal: record.signal,
              type: "exited",
            });
            channel.close(1000, "terminal_exited");
            release().catch(() => undefined);
          } else {
            finished = true;
            listener({ error: record.error, type: "error" });
            channel.close(1008, "terminal_error");
            release().catch(() => undefined);
          }
        } catch {
          finished = true;
          listener({
            error: { code: "invalidRequest", message: "Terminal returned an invalid record" },
            type: "error",
          });
          channel.close(1008, "invalid_terminal_record");
          release().catch(() => undefined);
        }
      });
      channel.addEventListener("error", () => {
        if (!finished) {
          finished = true;
          listener({ type: "disconnected" });
          release().catch(() => undefined);
        }
      });
      channel.addEventListener("close", () => {
        if (!finished) {
          finished = true;
          listener({ type: "disconnected" });
        }
        release().catch(() => undefined);
      });
      return {
        async close() {
          if (finished) return release();
          finished = true;
          if (channel.readyState === 1)
            channel.send(JSON.stringify(validateV2TerminalClientRecord({ type: "close" })));
          channel.close(1000, "terminal_closed");
          await release();
        },
        async disconnect() {
          disconnect();
          await release();
        },
        async input(text) {
          if (finished || channel.readyState !== 1) throw new Error("Terminal is not open");
          channel.send(
            JSON.stringify(
              validateV2TerminalClientRecord({ data: encodeUtf8(text), type: "input" }),
            ),
          );
        },
        async resize(cols, rows) {
          if (finished || channel.readyState !== 1) throw new Error("Terminal is not open");
          channel.send(
            JSON.stringify(validateV2TerminalClientRecord({ cols, rows, type: "resize" })),
          );
        },
      };
    },
  };
}

function encodeUtf8(value: string): string {
  return fromByteArray(new TextEncoder().encode(value));
}
