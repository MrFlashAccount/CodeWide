import { afterEach, describe, expect, it, vi } from "vitest";

type NativeCall = Record<string, unknown>;

const bridge = vi.hoisted(() => ({
  calls: [] as NativeCall[],
  cancelled: [] as string[],
  respond: (_request: NativeCall): Promise<unknown> => Promise.resolve(null),
}));

// WHY: The Kotlin module cannot run in Node. This substitute records the exact
// request DTO and returns the result shape that `CompanionHttpBridge.encode` produces.
vi.mock("react-native", () => ({
  NativeModules: {
    CodeWideNative: {
      companionHttpCancel(requestId: string) {
        bridge.cancelled.push(requestId);
      },
      async companionHttpRequest(requestJson: string) {
        const request: NativeCall = JSON.parse(requestJson);
        bridge.calls.push(request);
        return bridge.respond(request);
      },
    },
  },
  Platform: { OS: "android" },
}));

import { companionConnectionTransport } from "../src/native/companionTransport.native";

const connection = { endpoint: "wss://relay.example/c/route/v1/sync", id: "server-1" };

function textResult(status: number, text: string, headers: [string, string][] = []) {
  return { headers, payload: { kind: "text", text }, status };
}

afterEach(() => {
  bridge.calls.length = 0;
  bridge.cancelled.length = 0;
});

describe("native companion transport", () => {
  it("sends only the origin-relative path with headers and a text body", async () => {
    const { baseUrl, transport } = companionConnectionTransport(connection);
    bridge.respond = async () =>
      textResult(200, '{"ok":true}', [["content-type", "application/json"]]);

    const response = await transport.fetch(`${baseUrl}/v1/telemetry/events?batch=1`, {
      body: '{"events":[]}',
      headers: { authorization: "Bearer scoped", "content-type": "application/json" },
      method: "POST",
    });

    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(bridge.calls).toEqual([
      expect.objectContaining({
        body: { kind: "text", text: '{"events":[]}' },
        connectionId: "server-1",
        headers: [
          ["authorization", "Bearer scoped"],
          ["content-type", "application/json"],
        ],
        method: "POST",
        path: "/v1/telemetry/events?batch=1",
        sink: { kind: "text" },
      }),
    ]);
  });

  it("streams upload ranges from the file and discards HEAD bodies", async () => {
    const { baseUrl, transport } = companionConnectionTransport(connection);
    bridge.respond = async (request) =>
      request.method === "HEAD"
        ? { headers: [["x-upload-offset", "4"]], payload: { kind: "none" }, status: 204 }
        : textResult(308, "", [["x-upload-offset", "8"]]);

    const head = await transport.fetch(`${baseUrl}/v1/files/upload?rootId=r&path=a`, {
      method: "HEAD",
    });
    const put = await transport.fetch(`${baseUrl}/v1/files/upload?rootId=r&path=a`, {
      body: { kind: "file", length: 4, offset: 4, uri: "content://picked/document" },
      method: "PUT",
    });

    expect(head.status).toBe(204);
    expect(head.headers.get("x-upload-offset")).toBe("4");
    expect(put.status).toBe(308);
    expect(bridge.calls.map((call) => [call.method, call.body, call.sink])).toEqual([
      ["HEAD", { kind: "none" }, { kind: "discard" }],
      [
        "PUT",
        { kind: "file", length: 4, offset: 4, uri: "content://picked/document" },
        { kind: "text" },
      ],
    ]);
  });

  it("downloads into the requested file and reports the written byte count", async () => {
    const { baseUrl, transport } = companionConnectionTransport(connection);
    bridge.respond = async () => ({
      headers: [["x-content-sha256", "a".repeat(64)]],
      payload: { bytes: 10, kind: "file" },
      status: 206,
    });

    const downloaded = await transport.download(
      `${baseUrl}/v1/content/${"b".repeat(64)}`,
      { headers: { range: "bytes=0-9" } },
      { append: true, uri: "file:///cache/part" },
    );

    expect(downloaded.status).toBe(206);
    expect(downloaded.headers.get("x-content-sha256")).toBe("a".repeat(64));
    expect(bridge.calls[0]).toEqual(
      expect.objectContaining({
        headers: [["range", "bytes=0-9"]],
        method: "GET",
        sink: { append: true, kind: "file", uri: "file:///cache/part" },
      }),
    );
  });

  it("cancels the native request when the caller aborts", async () => {
    const { baseUrl, transport } = companionConnectionTransport(connection);
    const pending = Promise.withResolvers<unknown>();
    bridge.respond = async () => pending.promise;
    const controller = new AbortController();

    const response = transport.fetch(`${baseUrl}/v1/host-update`, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    pending.reject(new Error("Companion HTTP GET failed: IOException: Canceled"));

    await expect(response).rejects.toMatchObject({ name: "AbortError" });
    expect(bridge.cancelled).toEqual([bridge.calls[0]?.requestId]);
  });

  it("rejects addresses outside its own address space and malformed native results", async () => {
    const { baseUrl, transport } = companionConnectionTransport(connection);

    await expect(transport.fetch("https://relay.example/v1/host-update")).rejects.toThrow(
      "does not belong to this transport",
    );
    expect(bridge.calls).toEqual([]);

    bridge.respond = async () => ({ headers: [], payload: { kind: "file" }, status: 200 });
    await expect(transport.fetch(`${baseUrl}/v1/host-update`)).rejects.toThrow(
      "Companion HTTP payload is invalid",
    );
  });

  it("hands media views a Companion address scoped to the connection", async () => {
    const { baseUrl, transport } = companionConnectionTransport(connection);
    const uri = `${baseUrl}/v1/content/${"c".repeat(64)}`;

    expect(baseUrl).toBe("https://companion.invalid/server-1");
    await expect(transport.streamSource(uri, { authorization: "Bearer scoped" })).resolves.toEqual({
      headers: { authorization: "Bearer scoped" },
      uri,
    });
    await expect(
      companionConnectionTransport({ ...connection, id: "other" }).transport.streamSource(uri, {}),
    ).rejects.toThrow("does not belong to this transport");
    expect(bridge.calls).toEqual([]);
  });

  it("keeps the native transport error message for callers", async () => {
    const { baseUrl, transport } = companionConnectionTransport(connection);
    bridge.respond = async () => {
      throw new Error("Companion HTTP GET failed: SocketTimeoutException: timeout");
    };

    await expect(transport.fetch(`${baseUrl}/v1/files/preview?path=%2Fa`)).rejects.toThrow(
      "SocketTimeoutException: timeout",
    );
  });
});
