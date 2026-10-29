import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseConversationPage,
  type ConversationPage,
} from "../src/data/forgeConversationContract";
import { conversationImageSources } from "../src/features/pullRequestDetail/conversation/conversationImages";
import {
  AttachmentDiskCache,
  type AttachmentStorage,
  type CachedAttachment,
} from "../src/native/attachment-cache/disk-cache";
import type {
  DirectImageRequest,
  DirectImageResult,
} from "../src/native/attachment-cache/transfer-options";
import { DirectImageUnavailableError, loadDirectImage } from "../src/rendering/directImage";
import type { DirectImageGrant } from "../src/rendering/directImageSources";
import { DirectImageSourcesProvider } from "../src/rendering/directImageSources";
import { materializePrivateAsset } from "../src/rendering/private-asset";
import { cachedDirectImage } from "../src/native/attachment-cache/cached-transfer";
import {
  PrivateImageAccessProvider,
  usePrivateImageUri,
} from "../src/rendering/use-private-image-uri";
import type { GetTransferAccess } from "../src/data/private-transfer";

vi.mock("../src/rendering/private-asset", () => ({ materializePrivateAsset: vi.fn() }));
vi.mock("../src/data/operational-metrics", () => ({
  incrementMetric: vi.fn(),
  recordTiming: vi.fn(),
}));
vi.mock("../src/native/attachment-cache/cached-transfer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/native/attachment-cache/cached-transfer")>()),
  cachedDirectImage: vi.fn(),
}));

const ATTACHMENT =
  "https://github.com/user-attachments/assets/5f4e1a2b-0000-4000-8000-00000000c0de";
const SIGNED = "https://private-user-images.githubusercontent.com/1/2-5f4e.png?jwt=first";
const RESIGNED = "https://private-user-images.githubusercontent.com/1/2-5f4e.png?jwt=second";
const AVATAR = "https://avatars.githubusercontent.com/u/7?v=4";
const PRIVATE_AVATAR = "https://ghe.example/avatars/u/8";
const NOW = Date.parse("2026-10-21T09:00:00Z");

function wireComment(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    author: { avatarDirect: true, avatarUrl: AVATAR, kind: "user", login: "dana" },
    body: `![shot](${ATTACHMENT})`,
    createdAt: "2026-10-21T08:40:00Z",
    id: "c-1",
    media: [{ expiresAt: "2026-10-21T09:05:00Z", source: ATTACHMENT, url: SIGNED }],
    reactions: [],
    updatedAt: null,
    url: null,
    ...overrides,
  };
}

function page(...comments: Record<string, unknown>[]): ConversationPage {
  const parsed = parseConversationPage({
    entries: comments.map((comment) => ({ comment, kind: "comment" })),
    nextCursor: null,
    openIssuesBlockMerge: null,
  });
  if (parsed === null) {
    throw new Error("the fixture must parse");
  }
  return parsed;
}

function firstComment(value: ConversationPage) {
  const [entry] = value.entries;
  if (entry?.kind !== "comment") {
    throw new Error("the fixture starts with a comment");
  }
  return entry.comment;
}

describe("conversation media adapter", () => {
  it("decodes direct media with its expiry and the avatar mark", () => {
    const comment = firstComment(page(wireComment({})));
    expect(comment.media).toEqual([
      { expiresAtMs: Date.parse("2026-10-21T09:05:00Z"), source: ATTACHMENT, url: SIGNED },
    ]);
    expect(comment.author.avatarDirect).toBe(true);
  });

  it("treats absent fields as the companion path", () => {
    const comment = firstComment(
      page(wireComment({ author: { avatarUrl: AVATAR, kind: "user", login: "dana" }, media: undefined })),
    );
    expect(comment.media).toEqual([]);
    expect(comment.author.avatarDirect).toBe(false);
  });

  it("drops unusable entries and rejects malformed ones", () => {
    const comment = firstComment(
      page(
        wireComment({
          media: [
            { expiresAt: null, source: "https://a.example/1", url: "http://plain.example/1" },
            { expiresAt: "soon", source: "https://a.example/2", url: "https://cdn.example/2" },
            { expiresAt: null, source: ATTACHMENT, url: SIGNED },
          ],
        }),
      ),
    );
    expect(comment.media).toEqual([{ expiresAtMs: null, source: ATTACHMENT, url: SIGNED }]);
    expect(
      parseConversationPage({
        entries: [{ comment: wireComment({ media: [{ source: ATTACHMENT }] }), kind: "comment" }],
        nextCursor: null,
        openIssuesBlockMerge: null,
      }),
    ).toBeNull();
  });
});

describe("conversation image sources", () => {
  const owner = {
    cacheScope: "connection-1",
    current: () => null,
    refresh: async () => undefined,
  };

  it("grants a body image its direct URL under the stable source identity", () => {
    const sources = conversationImageSources(page(wireComment({})), owner);
    expect(sources.cacheScope).toBe("connection-1");
    expect(sources.grant(ATTACHMENT)).toEqual({
      expiresAtMs: Date.parse("2026-10-21T09:05:00Z"),
      identity: ATTACHMENT,
      url: SIGNED,
    });
  });

  it("grants only avatars the plugin marked direct", () => {
    const sources = conversationImageSources(
      page(
        wireComment({}),
        wireComment({
          author: { avatarDirect: false, avatarUrl: PRIVATE_AVATAR, kind: "bot", login: "ops" },
          id: "c-2",
        }),
      ),
      owner,
    );
    expect(sources.grant(AVATAR)).toEqual({ expiresAtMs: null, identity: AVATAR, url: AVATAR });
    expect(sources.grant(PRIVATE_AVATAR)).toBeNull();
  });

  it("leaves images without a media entry on the companion path", () => {
    const sources = conversationImageSources(page(wireComment({ media: [] })), owner);
    expect(sources.grant(ATTACHMENT)).toBeNull();
    expect(sources.grant("https://example.com/elsewhere.png")).toBeNull();
  });

  it("re-reads the conversation once and never returns the stale URL again", async () => {
    let current = page(wireComment({}));
    const refresh = vi.fn(async () => {
      current = page(
        wireComment({
          media: [{ expiresAt: "2026-10-21T09:10:00Z", source: ATTACHMENT, url: RESIGNED }],
        }),
      );
    });
    const sources = conversationImageSources(current, {
      cacheScope: "connection-1",
      current: () => current,
      refresh,
    });
    const stale = sources.grant(ATTACHMENT);
    if (stale === null) {
      throw new Error("the attachment is granted");
    }
    expect((await sources.renew(ATTACHMENT, stale))?.url).toBe(RESIGNED);
    // A second image of the same refresh reuses the fresh data without another read.
    expect((await sources.renew(ATTACHMENT, stale))?.url).toBe(RESIGNED);
    expect(refresh).toHaveBeenCalledTimes(1);
    const unchanged = conversationImageSources(current, {
      cacheScope: "connection-1",
      current: () => current,
      refresh: async () => undefined,
    });
    const fresh = unchanged.grant(ATTACHMENT);
    if (fresh === null) {
      throw new Error("the attachment is granted");
    }
    await expect(unchanged.renew(ATTACHMENT, fresh)).resolves.toBeNull();
  });
});

describe("direct image loading", () => {
  const expiring: DirectImageGrant = {
    expiresAtMs: NOW + 60_000,
    identity: ATTACHMENT,
    url: SIGNED,
  };
  const renewedGrant: DirectImageGrant = { ...expiring, expiresAtMs: NOW + 300_000, url: RESIGNED };

  function reader(results: readonly DirectImageResult[]) {
    const requests: DirectImageRequest[] = [];
    const read = vi.fn(async (request: DirectImageRequest): Promise<DirectImageResult> => {
      requests.push(request);
      const result = results[requests.length - 1];
      if (result === undefined) {
        throw new Error("unexpected read");
      }
      return result;
    });
    return { read, requests };
  }

  function load(
    grant: DirectImageGrant,
    read: (request: DirectImageRequest) => Promise<DirectImageResult>,
    renew: (reference: string, stale: DirectImageGrant) => Promise<DirectImageGrant | null>,
    now = NOW,
  ) {
    return loadDirectImage({
      grant,
      now: () => now,
      read,
      reference: ATTACHMENT,
      signal: new AbortController().signal,
      sources: { cacheScope: "connection-1", renew },
    });
  }

  it("reads the live URL under the source identity", async () => {
    const { read, requests } = reader([{ status: "ready", uri: "file:///cache/a" }]);
    const renew = vi.fn(async () => renewedGrant);
    await expect(load(expiring, read, renew)).resolves.toEqual({ uri: "file:///cache/a" });
    expect(requests).toEqual([
      expect.objectContaining({ identity: ATTACHMENT, scope: "connection-1", uri: SIGNED }),
    ]);
    expect(renew).not.toHaveBeenCalled();
  });

  it("serves a cached copy after expiry without renewing", async () => {
    const { read, requests } = reader([{ status: "ready", uri: "file:///cache/a" }]);
    const renew = vi.fn(async () => renewedGrant);
    await expect(load(expiring, read, renew, NOW + 120_000)).resolves.toEqual({
      uri: "file:///cache/a",
    });
    expect(requests[0]?.uri).toBeNull();
    expect(renew).not.toHaveBeenCalled();
  });

  it("renews an expired, uncached URL once and reads the fresh one", async () => {
    const { read, requests } = reader([
      { status: "missing" },
      { status: "ready", uri: "file:///cache/a" },
    ]);
    const renew = vi.fn(async () => renewedGrant);
    await expect(load(expiring, read, renew, NOW + 120_000)).resolves.toEqual({
      uri: "file:///cache/a",
    });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(requests.map((request) => request.uri)).toEqual([null, RESIGNED]);
  });

  it("does not loop when the fresh URL is refused too", async () => {
    const { read } = reader([
      { httpStatus: 404, status: "rejected" },
      { httpStatus: 404, status: "rejected" },
    ]);
    const renew = vi.fn(async () => renewedGrant);
    const failure = load(expiring, read, renew);
    await expect(failure).rejects.toBeInstanceOf(DirectImageUnavailableError);
    await expect(failure).rejects.toMatchObject({ status: 404 });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("stops when no fresh grant exists or the refresh fails", async () => {
    const missing = reader([{ status: "missing" }]);
    await expect(
      load(expiring, missing.read, async () => null, NOW + 120_000),
    ).rejects.toMatchObject({ status: 410 });
    const offline = reader([{ status: "missing" }]);
    await expect(
      load(
        expiring,
        offline.read,
        async () => {
          throw new Error("offline");
        },
        NOW + 120_000,
      ),
    ).rejects.toMatchObject({ status: 410 });
  });

  it("never renews a non-expiring URL or a server failure", async () => {
    const renew = vi.fn(async () => renewedGrant);
    const avatar = reader([{ httpStatus: 404, status: "rejected" }]);
    await expect(
      load({ ...expiring, expiresAtMs: null }, avatar.read, renew),
    ).rejects.toMatchObject({ status: 404 });
    const outage = reader([{ httpStatus: 503, status: "rejected" }]);
    await expect(load(expiring, outage.read, renew)).rejects.toMatchObject({ status: 503 });
    expect(renew).not.toHaveBeenCalled();
  });
});

describe("granted image companion fallback", () => {
  let sequence = 0;
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function renderImage(grant: DirectImageGrant) {
    sequence += 1;
    const scope = `fallback-${String(sequence)}`;
    const renew = vi.fn(async () => ({ ...grant, url: RESIGNED }));
    const getAccess: GetTransferAccess = async () => {
      throw new Error("the materializer mock owns access");
    };
    function Image() {
      const image = usePrivateImageUri(ATTACHMENT);
      return createElement("image-result", {
        failed: image.failed,
        headers: image.headers,
        uri: image.uri,
      });
    }
    const tree = createElement(
      PrivateImageAccessProvider,
      { getAccess, scope, children: null },
      createElement(
        DirectImageSourcesProvider,
        {
          children: null,
          sources: { cacheScope: scope, grant: () => grant, renew },
        },
        createElement(Image),
      ),
    );
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(tree);
    });
    if (renderer === undefined) {
      throw new Error("the image must mount");
    }
    return { getAccess, renderer, renew };
  }

  const grant: DirectImageGrant = { expiresAtMs: null, identity: ATTACHMENT, url: SIGNED };

  it.each(["http", "network"])("falls back once after a direct %s failure", async (failure) => {
    vi.useFakeTimers();
    if (failure === "http") {
      vi.mocked(cachedDirectImage).mockResolvedValue({ httpStatus: 404, status: "rejected" });
    } else {
      vi.mocked(cachedDirectImage).mockRejectedValue(new Error("network unavailable"));
    }
    const resolved = { headers: { authorization: "test-access" }, uri: "file:///companion/image" };
    vi.mocked(materializePrivateAsset).mockResolvedValue(resolved);
    const { getAccess, renderer, renew } = await renderImage(grant);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(renderer.root.findByType("image-result").props).toEqual({
      failed: false,
      ...resolved,
    });
    expect(materializePrivateAsset).toHaveBeenCalledExactlyOnceWith(
      { kind: "remote", url: ATTACHMENT },
      expect.objectContaining({ getAccess, variant: "preview" }),
    );
    expect(cachedDirectImage).toHaveBeenCalledTimes(1);
    expect(renew).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it("shows the failure placeholder after the companion fallback fails without retrying", async () => {
    vi.useFakeTimers();
    vi.mocked(cachedDirectImage).mockRejectedValue(new Error("network unavailable"));
    vi.mocked(materializePrivateAsset).mockRejectedValue(new Error("companion unavailable"));
    const { renderer, renew } = await renderImage(grant);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(renderer.root.findByType("image-result").props).toEqual({
      failed: true,
      headers: undefined,
      uri: null,
    });
    expect(cachedDirectImage).toHaveBeenCalledTimes(1);
    expect(materializePrivateAsset).toHaveBeenCalledTimes(1);
    expect(renew).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it("renews an expired signed URL once before falling back to the original source", async () => {
    vi.mocked(cachedDirectImage)
      .mockResolvedValueOnce({ status: "missing" })
      .mockResolvedValueOnce({ httpStatus: 404, status: "rejected" });
    vi.mocked(materializePrivateAsset).mockResolvedValue({ headers: {}, uri: "file:///fallback" });
    const { renderer, renew } = await renderImage({ ...grant, expiresAtMs: 0 });
    expect(renderer.root.findByType("image-result").props).toMatchObject({
      failed: false,
      uri: "file:///fallback",
    });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(cachedDirectImage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(cachedDirectImage).mock.calls.map(([request]) => request.uri)).toEqual([
      null,
      RESIGNED,
    ]);
    expect(materializePrivateAsset).toHaveBeenCalledExactlyOnceWith(
      { kind: "remote", url: ATTACHMENT },
      expect.anything(),
    );
    expect(renew.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(materializePrivateAsset).mock.invocationCallOrder[0] ?? 0,
    );
    await act(async () => renderer.unmount());
  });
});

class MemoryStorage implements AttachmentStorage {
  readonly files = new Map<string, string>();
  readonly records = new Map<string, CachedAttachment>();
  async restore() {
    return [...this.records.values()];
  }
  async exists(key: string, bytes: number) {
    return this.files.get(key)?.length === bytes;
  }
  async touch(entry: CachedAttachment) {
    this.records.set(entry.key, { ...entry });
  }
  async remove(key: string) {
    this.files.delete(key);
    this.records.delete(key);
  }
  uri(key: string) {
    return `file:///cache/${key}`;
  }
}

describe("identity-keyed disk cache lookup", () => {
  it("finds a completed entry without knowing its size, after a restart too", async () => {
    const storage = new MemoryStorage();
    const cache = new AttachmentDiskCache(storage, () => 1, 64);
    expect(await cache.acquireExisting("image")).toBeNull();
    const written = await cache.acquire("image", { bytes: 5, scopeKey: "s" }, async () => {
      storage.files.set("image", "bytes");
    });
    written?.release();
    const reopened = new AttachmentDiskCache(storage, () => 2, 64);
    const lease = await reopened.acquireExisting("image");
    expect(lease?.uri).toBe("file:///cache/image");
    lease?.release();
    storage.files.delete("image");
    expect(await reopened.acquireExisting("image")).toBeNull();
  });
});
