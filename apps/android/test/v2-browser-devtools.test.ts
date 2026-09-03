import { describe, expect, it } from "vitest";

import { parseDevToolsDocumentMessage } from "../src/v2/infrastructure/ports/browserDevToolsDocument";
import {
  chromiumDevToolsUrl,
  type DevToolsTarget,
} from "../src/v2/infrastructure/ports/browserDevToolsProtocol";

const ENDPOINT = {
  host: "127.0.0.1",
  port: 41_237,
  token: "a".repeat(64),
  tracingSupported: true,
} as const;

const TARGET: DevToolsTarget = {
  id: "page-1",
  title: "Preview",
  type: "page",
  url: "http://127.0.0.1:32000/",
  webSocketDebuggerUrl: "ws://127.0.0.1:9000/devtools/page/page-1?existing=true",
};

describe("V2 internal browser DevTools", () => {
  it("builds a token-bound local frontend and CDP proxy URL", () => {
    const url = new URL(chromiumDevToolsUrl(ENDPOINT, TARGET));
    expect(url.origin).toBe("http://127.0.0.1:41237");
    expect(url.pathname).toBe(
      `/browser-devtools/${ENDPOINT.token}/front_end/inspector.html`,
    );
    expect(url.searchParams.get("can_dock")).toBe("true");
    expect(url.searchParams.get("ws")).toBe(
      `127.0.0.1:41237/devtools/page/page-1?existing=true&codewide_token=${ENDPOINT.token}`,
    );
  });

  it("accepts only typed dock, transport and health messages", () => {
    expect(
      parseDevToolsDocumentMessage(
        JSON.stringify({ side: "right", source: "codewide-devtools-dock" }),
      ),
    ).toEqual({ side: "right", source: "dock" });
    expect(
      parseDevToolsDocumentMessage(
        JSON.stringify({
          code: 1006,
          event: "close",
          reason: "lost",
          source: "codewide-devtools-transport",
        }),
      ),
    ).toEqual({ code: 1_006, event: "close", reason: "lost", source: "transport" });
    expect(
      parseDevToolsDocumentMessage(
        JSON.stringify({ source: "codewide-devtools-health", state: "ready" }),
      ),
    ).toEqual({ message: null, source: "health", state: "ready" });
    expect(
      parseDevToolsDocumentMessage(
        JSON.stringify({ side: "center", source: "codewide-devtools-dock" }),
      ),
    ).toBeNull();
    expect(parseDevToolsDocumentMessage("not json")).toBeNull();
  });
});
