import { describe, expect, it, vi } from "vitest";
import { ComposerUploads, type ComposerUploadRequest } from "../src/data/composer-uploads";
import type { StoredDraftAttachment } from "../src/data/thread-ui-state-types";
import type { TransferProgress } from "../src/native/file-transfer";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(id: string, scope = "server\u0000thread") {
  const transfer = deferred<{ bytes: number; sha256: string }>();
  const cancel = vi.fn();
  const commits: StoredDraftAttachment[] = [];
  let progress: (value: TransferProgress) => void = () => undefined;
  const request: ComposerUploadRequest = {
    scope,
    attachment: { id, rootId: "attachments", path: `thread/${id}.png`, name: `${id}.png`, kind: "image" },
    preview: { uri: `file:///cache/${id}.png`, text: null, bytes: 100, mimeType: "image/png" },
    start: (receive) => { progress = receive; return { promise: transfer.promise, cancel }; },
    readText: async () => null,
    commit: async (attachment, isCurrent) => { if (isCurrent()) commits.push(attachment); },
  };
  return { request, transfer, cancel, commits, progress: (value: TransferProgress) => progress(value) };
}

describe("composer upload operations", () => {
  it("replaces an uploading image and ignores the original upload finishing later", async () => {
    const model = new ComposerUploads(), original = fixture("photo"), edited = fixture("photo");
    const attachment = { ...edited.request.attachment, name: "annotated.png", path: "thread/annotated.png" };
    model.stage(original.request);
    model.stage({ ...edited.request, attachment, preview: { ...edited.request.preview, uri: "file:///cache/annotated.png" } });
    expect(original.cancel).toHaveBeenCalledOnce();
    expect(model.count(original.request.scope, [original.request.attachment])).toBe(1);
    expect(model.entries(original.request.scope)[0]?.preview.uri).toBe("file:///cache/annotated.png");
    original.transfer.resolve({ bytes: 100, sha256: "original" });
    await Promise.resolve();
    expect(original.commits).toEqual([]);
    edited.transfer.resolve({ bytes: 100, sha256: "edited" });
    await vi.waitFor(() => expect(model.blocksSend(original.request.scope)).toBe(false));
    const ready = model.readyAttachments(original.request.scope, [original.request.attachment]);
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ id: "photo", name: "annotated.png", path: "thread/annotated.png", preview: { uri: "file:///cache/annotated.png" } });
  });
  it("shows a local card immediately and blocks Send until durable commit", async () => {
    const model = new ComposerUploads(), f = fixture("one"), saved = deferred<void>();
    model.stage({ ...f.request, commit: () => saved.promise });
    expect(model.entries(f.request.scope)[0]?.preview.uri).toBe("file:///cache/one.png");
    expect(model.blocksSend(f.request.scope)).toBe(true);
    f.transfer.resolve({ bytes: 100, sha256: "hash" });
    await Promise.resolve();
    expect(model.blocksSend(f.request.scope)).toBe(true);
    saved.resolve();
    await vi.waitFor(() => expect(model.blocksSend(f.request.scope)).toBe(false));
    expect(model.readyAttachments(f.request.scope, []).map((item) => item.id)).toEqual(["one"]);
  });

  it("keeps selection order despite concurrent out-of-order completions and navigation", async () => {
    const model = new ComposerUploads(), first = fixture("first"), second = fixture("second"), other = fixture("other", "server\u0000other");
    model.stage(first.request); model.stage(second.request); model.stage(other.request);
    second.transfer.resolve({ bytes: 100, sha256: "second" });
    await vi.waitFor(() => expect(second.commits).toHaveLength(1));
    expect(model.entries(first.request.scope).map((item) => item.attachment.id)).toEqual(["first", "second"]);
    expect(model.blocksSend(first.request.scope)).toBe(true);
    first.transfer.resolve({ bytes: 100, sha256: "first" });
    await vi.waitFor(() => expect(model.blocksSend(first.request.scope)).toBe(false));
    expect(model.readyAttachments(first.request.scope, second.commits).map((item) => item.id)).toEqual(["first", "second"]);
    expect(model.blocksSend(other.request.scope)).toBe(true);
  });

  it("does not resurrect a removed attachment when cancellation loses the network race", async () => {
    const model = new ComposerUploads(), f = fixture("removed");
    model.stage(f.request); model.remove(f.request.scope, "removed");
    expect(f.cancel).toHaveBeenCalledOnce();
    f.progress({ phase: "transferring", transferred: 100, total: 100 });
    f.transfer.resolve({ bytes: 100, sha256: "late" });
    await Promise.resolve();
    expect(f.commits).toEqual([]);
    expect(model.entries(f.request.scope)).toEqual([]);
    expect(model.blocksSend(f.request.scope)).toBe(false);
  });

  it("invalidates a persistence callback when removed before its transaction starts", async () => {
    const model = new ComposerUploads(), f = fixture("removed"), gate = deferred<void>();
    model.stage({ ...f.request, commit: async (item, isCurrent) => { await gate.promise; if (isCurrent()) f.commits.push(item); } });
    f.transfer.resolve({ bytes: 100, sha256: "hash" });
    await Promise.resolve(); model.remove(f.request.scope, "removed"); gate.resolve();
    await Promise.resolve();
    expect(f.commits).toEqual([]);
  });

  it("retries the same card and destination, retaining errors until explicit retry", async () => {
    const model = new ComposerUploads(), f = fixture("retry"), retry = fixture("retry");
    let attempts = 0;
    model.stage({ ...f.request, start: (progress) => (++attempts === 1 ? f : retry).request.start(progress) });
    f.transfer.reject(new Error("Upload unavailable"));
    await vi.waitFor(() => expect(model.entries(f.request.scope)[0]?.state).toEqual({ status: "error", message: "Upload unavailable" }));
    expect(model.blocksSend(f.request.scope)).toBe(true);
    model.retry(f.request.scope, "retry");
    model.retry(f.request.scope, "retry");
    expect(attempts).toBe(2);
    expect(model.entries(f.request.scope)).toHaveLength(1);
    retry.transfer.resolve({ bytes: 100, sha256: "hash" });
    await vi.waitFor(() => expect(model.blocksSend(f.request.scope)).toBe(false));
    expect(f.commits[0]?.id).toBe("retry");
  });

  it("disposes only uploads belonging to the deleted server", () => {
    const model = new ComposerUploads(), a = fixture("a"), b = fixture("b", "another\u0000thread");
    model.stage(a.request); model.stage(b.request);
    model.deleteConnection("server");
    expect(a.cancel).toHaveBeenCalledOnce();
    expect(b.cancel).not.toHaveBeenCalled();
    expect(model.entries(a.request.scope)).toEqual([]);
  });
});
