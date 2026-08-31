import { fromByteArray, toByteArray } from "base64-js";
import {
  parseV2TerminalServerRecord,
  validateV2TerminalClientRecord,
} from "@codewide/sync-client/v2";

import type { TerminalTransport } from "../../application/ports/terminalTransport";
import { acquireSharedConnectionLease } from "../connection/sharedConnectionAdapter.native";

export function createClosedTerminalTransport(sessionId: () => string): TerminalTransport {
  return {
    async open(owner, generation, cwd, listener) {
      const connection = await acquireSharedConnectionLease(owner.savedServerId);
      const channel = connection.lease.openDuplex("terminal-v2");
      const id = sessionId();
      let closed = false;
      channel.addEventListener("open", () => {
        channel.send(
          JSON.stringify(
            validateV2TerminalClientRecord({
              cols: 80,
              create: true,
              cwd,
              generation,
              offset: "0",
              rows: 24,
              sessionId: id,
              threadId: owner.threadId,
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
          if (record.type === "opened") listener({ type: "opened" });
          else if (record.type === "output")
            listener({ data: decodeUtf8(record.data), type: "output" });
          else if (record.type === "exited") listener({ type: "exited" });
          else listener({ message: record.error.message, type: "error" });
        } catch {
          listener({ message: "Terminal returned an invalid record", type: "error" });
          channel.close(1008, "invalid_terminal_record");
        }
      });
      channel.addEventListener("error", () =>
        listener({ message: "Terminal transport failed", type: "error" }),
      );
      channel.addEventListener("close", () => {
        if (!closed) listener({ type: "exited" });
      });
      return {
        async close() {
          if (closed) return;
          closed = true;
          if (channel.readyState === 1)
            channel.send(JSON.stringify(validateV2TerminalClientRecord({ type: "close" })));
          channel.close(1000, "terminal_closed");
          await connection.lease.release();
        },
        id,
        async input(text) {
          if (closed || channel.readyState !== 1) throw new Error("Terminal is not open");
          channel.send(
            JSON.stringify(
              validateV2TerminalClientRecord({ data: encodeUtf8(text), type: "input" }),
            ),
          );
        },
      };
    },
  };
}

function decodeUtf8(value: string): string {
  return new TextDecoder().decode(toByteArray(value));
}

function encodeUtf8(value: string): string {
  return fromByteArray(new TextEncoder().encode(value));
}
