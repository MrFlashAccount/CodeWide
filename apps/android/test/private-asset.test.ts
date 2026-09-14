import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPrivateAsset, fetchScopedUpload, readPrivateAssetText } from "../src/data/private-transfer";
import { recoverPrivateAsset } from "../src/rendering/private-asset-recovery";

describe("private asset transport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses one ranged path reader and refreshes an expired session once", async () => {
    const getAccess = vi.fn(async (forceRefresh = false) => ({
      baseUrl: "https://companion.example",
      authorization: forceRefresh ? "Bearer fresh" : "Bearer stale",
    }));
    const requests: Array<{ url: string; authorization: string | null; range: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(input),
        authorization: headers.get("authorization"),
        range: headers.get("range"),
      });
      if (headers.get("authorization") === "Bearer stale") return new Response("expired", { status: 401 });
      return new Response("hello", {
        status: 206,
        headers: {
          "content-range": "bytes 10-14/40",
          "content-type": "text/plain",
        },
      });
    }));

    const loaded = await readPrivateAssetText(
      { kind: "path", path: "/tmp/example.txt" },
      getAccess,
      { offset: 10, limit: 5, accept: "text/plain" },
    );

    expect(getAccess.mock.calls).toEqual([[false], [true]]);
    expect(requests).toEqual([
      {
        url: "https://companion.example/v1/files/preview?path=%2Ftmp%2Fexample.txt",
        authorization: "Bearer stale",
        range: "bytes=10-14",
      },
      {
        url: "https://companion.example/v1/files/preview?path=%2Ftmp%2Fexample.txt",
        authorization: "Bearer fresh",
        range: "bytes=10-14",
      },
    ]);
    expect(loaded).toEqual({
      text: "hello",
      contentType: "text/plain",
      totalBytes: 40,
      nextOffset: 15,
      truncated: true,
    });
  });

  it("preserves the Android loopback capability on private file requests", async () => {
    const request = vi.fn(async () => new Response("file", { status: 200 }));
    vi.stubGlobal("fetch", request);
    const capability = "a".repeat(43);

    await fetchPrivateAsset(
      { kind: "path", path: "/tmp/example.txt" },
      async () => ({
        baseUrl: `http://127.0.0.1:41234/${capability}`,
        authorization: "Bearer token",
      }),
    );

    expect(String(request.mock.calls[0]?.[0])).toBe(
      `http://127.0.0.1:41234/${capability}/v1/files/preview?path=%2Ftmp%2Fexample.txt`,
    );
  });

  it("reads projected tool content through the same transport", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("tool output", {
      status: 200,
      headers: { "content-length": "11", "content-type": "text/plain" },
    })));
    const id = "a".repeat(64);
    const loaded = await readPrivateAssetText(
      { kind: "content", id },
      async () => ({ baseUrl: "https://companion.example", authorization: "Bearer token" }),
    );
    expect(loaded.text).toBe("tool output");
    expect(loaded.truncated).toBe(false);
  });

  it("downloads scoped files through the same authenticated reader", async () => {
    const request = vi.fn(async () => new Response("file", { status: 200 }));
    vi.stubGlobal("fetch", request);

    await fetchPrivateAsset(
      { kind: "scoped", rootId: "workspace", path: "docs/readme.md" },
      async () => ({ baseUrl: "https://companion.example", authorization: "Bearer token" }),
      { headers: { range: "bytes=0-3" } },
    );

    expect(request).toHaveBeenCalledOnce();
    expect(String(request.mock.calls[0]?.[0])).toBe("https://companion.example/v1/files/download?rootId=workspace&path=docs%2Freadme.md");
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer token");
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("range")).toBe("bytes=0-3");
  });

  it("cache-busts an overwritten scoped draft image", async () => {
    const request = vi.fn(async () => new Response("file", { status: 200 }));
    vi.stubGlobal("fetch", request);

    await fetchPrivateAsset(
      { kind: "scoped", rootId: "attachments", path: "drawing.png", cacheRevision: "42" },
      async () => ({ baseUrl: "https://companion.example", authorization: "Bearer token" }),
    );

    expect(String(request.mock.calls[0]?.[0])).toBe("https://companion.example/v1/files/download?rootId=attachments&path=drawing.png&v=42");
  });

  it("refreshes authorization for resumable upload requests", async () => {
    const getAccess = vi.fn(async (forceRefresh = false) => ({
      baseUrl: "https://companion.example",
      authorization: forceRefresh ? "Bearer fresh" : "Bearer stale",
    }));
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => (
      new Response(null, { status: new Headers(init?.headers).get("authorization") === "Bearer stale" ? 401 : 204 })
    ));
    vi.stubGlobal("fetch", request);

    const response = await fetchScopedUpload("workspace", "image.png", getAccess, { method: "HEAD" });

    expect(response.status).toBe(204);
    expect(getAccess.mock.calls).toEqual([[false], [true]]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[1]?.[0])).toBe("https://companion.example/v1/files/upload?rootId=workspace&path=image.png");
  });

  it("passes absolute and parent-relative upload destinations to the host", async () => {
    const request = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", request);
    const getAccess = async () => ({
      baseUrl: "https://companion.example",
      authorization: "Bearer token",
    });

    await fetchScopedUpload("workspace", "/tmp/image.png", getAccess, { method: "HEAD" });
    await fetchScopedUpload("workspace", "../image.png", getAccess, { method: "HEAD" });

    expect(request).toHaveBeenCalledTimes(2);
    expect(String(request.mock.calls[0]?.[0])).toBe("https://companion.example/v1/files/upload?rootId=workspace&path=%2Ftmp%2Fimage.png");
    expect(String(request.mock.calls[1]?.[0])).toBe("https://companion.example/v1/files/upload?rootId=workspace&path=..%2Fimage.png");
  });
});

describe("private asset recovery", () => {
  it("restores missing content once before retrying", async () => {
    const materialize = vi.fn()
      .mockRejectedValueOnce(new Error("Private attachment unavailable (404)"))
      .mockResolvedValueOnce({ uri: "file:///cache/image.bin", headers: {} });
    const recover = vi.fn(async () => undefined);
    await expect(recoverPrivateAsset(materialize, recover)).resolves.toEqual({ uri: "file:///cache/image.bin", headers: {} });
    expect(recover).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledTimes(2);
  });

  it("does not hide an unrelated failure behind hydration", async () => {
    const materialize = vi.fn(async () => { throw new Error("Image decoder failed"); });
    const recover = vi.fn(async () => undefined);
    await expect(recoverPrivateAsset(materialize, recover)).rejects.toThrow("Image decoder failed");
    expect(recover).not.toHaveBeenCalled();
  });

  it("refreshes authorization without changing the attachment identity", async () => {
    const materialize = vi.fn(async (refresh: boolean) => {
      if (!refresh) throw new Error("Private attachment unavailable (401)");
      return { uri: "file:///cache/image.bin", headers: {} };
    });
    await expect(recoverPrivateAsset(materialize, null)).resolves.toEqual({ uri: "file:///cache/image.bin", headers: {} });
    expect(materialize.mock.calls).toEqual([[false], [true]]);
  });
});
