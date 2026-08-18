import { beforeEach, describe, expect, it, vi } from "vitest";

const { materializePrivateImageUri } = vi.hoisted(() => ({
  materializePrivateImageUri: vi.fn(async (uri: string) => uri),
}));

vi.mock("../src/rendering/private-image-cache", () => ({ materializePrivateImageUri }));

import { fetchPrivateAsset, fetchScopedUpload, readPrivateAssetText } from "../src/data/private-transfer";
import { materializePrivateAsset } from "../src/rendering/private-asset";

describe("private asset transport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    materializePrivateImageUri.mockImplementation(async (uri: string) => uri);
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
});

describe("private asset recovery", () => {
  beforeEach(() => {
    materializePrivateImageUri.mockReset();
  });

  it("rehydrates a missing projected content asset before retrying the download", async () => {
    materializePrivateImageUri
      .mockRejectedValueOnce(new Error("Private image download failed (404)"))
      .mockResolvedValueOnce("file:///cache/image.png");
    const recover = vi.fn().mockResolvedValue(undefined);

    await expect(materializePrivateAsset(
      { kind: "content", id: "a".repeat(64) },
      async () => ({ baseUrl: "https://companion.test", authorization: "Bearer session" }),
      recover,
    )).resolves.toBe("file:///cache/image.png");

    expect(recover).toHaveBeenCalledOnce();
    expect(materializePrivateImageUri).toHaveBeenCalledTimes(2);
  });

  it("does not hide an unrelated private image failure behind turn hydration", async () => {
    materializePrivateImageUri.mockRejectedValue(new Error("Image decoder failed"));
    const recover = vi.fn().mockResolvedValue(undefined);

    await expect(materializePrivateAsset(
      { kind: "content", id: "b".repeat(64) },
      async () => ({ baseUrl: "https://companion.test", authorization: "Bearer session" }),
      recover,
    )).rejects.toThrow("Image decoder failed");

    expect(recover).not.toHaveBeenCalled();
  });
});
