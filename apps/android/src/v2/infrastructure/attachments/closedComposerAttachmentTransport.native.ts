import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  V2AttachmentStageRequest,
  V2AttachmentStageResponse,
  V2AttachmentUploadResponse,
} from "@codewide/sync-client/v2";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import type {
  ComposerAttachmentPickKind,
  ComposerAttachmentTransport,
  ComposerAttachmentUploadInput,
  LocalComposerAttachment,
  PersistedLocalComposerAttachment,
  RunningComposerAttachmentUpload,
} from "../../application/ports/composerAttachmentTransport";
import type { SavedServerId } from "../../domain/ids";
import {
  authorizedAttachmentFetch,
  authorizedAttachmentUpload,
  hashContentDocument,
  requireAttachmentPath,
} from "./closedAttachmentHttp.native";

interface OwnedFile {
  file: File;
}

type UploadResponse = Pick<V2AttachmentUploadResponse, "sha256"> & {
  attachment: Pick<V2AttachmentUploadResponse["attachment"], "id">;
};

const HASH_CHUNK_BYTES = 4 * 1024 * 1024;
const HASH_YIELD_BYTES = 8 * 1024 * 1024;
const DRAFT_DIRECTORY_NAME = "codewide-v2-composer-drafts";

/** Keeps filesystem handles, bearer credentials, and the pinned loopback proxy inside infrastructure. */
export function createClosedComposerAttachmentTransport(): ComposerAttachmentTransport {
  const owned = new Map<string, OwnedFile>();
  return {
    createBytes(name, mediaType, value) {
      return registerTemporary(owned, name, mediaType, value);
    },
    createText(name, mediaType, value) {
      return registerTemporary(owned, name, mediaType, value);
    },
    async pick(kind) {
      requirePlatform();
      const picked = await File.pickFileAsync({ mimeTypes: pickerMimeTypes(kind) });
      if (picked.canceled) return null;
      return copyIntoDraftStorage(owned, picked.result);
    },
    reference(attachment) {
      const entry = owned.get(attachment.handle);
      if (entry === undefined) throw new Error("Selected attachment is unavailable");
      return {
        mediaType: attachment.mediaType,
        name: attachment.name,
        sizeBytes: attachment.sizeBytes,
        token: entry.file.uri,
      };
    },
    release(attachment) {
      const entry = owned.get(attachment.handle);
      owned.delete(attachment.handle);
      if (entry !== undefined) deleteTemporary(entry.file);
    },
    restore(reference) {
      return restorePersisted(owned, reference);
    },
    upload(input) {
      return startUpload(owned, input);
    },
  };
}

function startUpload(
  owned: Map<string, OwnedFile>,
  input: ComposerAttachmentUploadInput,
): RunningComposerAttachmentUpload {
  const entry = owned.get(input.attachment.handle);
  if (entry === undefined) throw new Error("Selected attachment is unavailable");
  const abort = new AbortController();
  const promise = uploadFile(entry.file, input, abort.signal);
  return { cancel: () => abort.abort(), promise };
}

async function uploadFile(
  file: File,
  input: ComposerAttachmentUploadInput,
  signal: AbortSignal,
): Promise<{ attachmentId: string; discard(): Promise<void> }> {
  const hash = await hashFile(file, input, signal);
  const stageRequest = {
    mediaType: input.attachment.mediaType,
    name: input.attachment.name,
    sha256: hash,
    sizeBytes: String(input.attachment.sizeBytes),
    threadId: input.target.threadId,
    workspace: input.target.workspace,
  } satisfies V2AttachmentStageRequest;
  const stageResponse = await authorizedAttachmentFetch(input.savedServerId, "/v2/attachments", {
    body: JSON.stringify(stageRequest),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal,
  });
  const staged = await readJson(stageResponse, parseStageResponse, "Attachment staging failed");
  input.onProgress({
    phase: "uploading",
    totalBytes: input.attachment.sizeBytes,
    transferredBytes: 0,
  });
  try {
    const uploadResponse = await authorizedAttachmentUpload({
      expectedBytes: input.attachment.sizeBytes,
      file,
      mediaType: input.attachment.mediaType,
      onProgress: (transferredBytes) =>
        input.onProgress({
          phase: "uploading",
          totalBytes: input.attachment.sizeBytes,
          transferredBytes,
        }),
      path: staged.uploadPath,
      savedServerId: input.savedServerId,
      sha256: hash,
      signal,
    });
    input.onProgress({
      phase: "verifying",
      totalBytes: input.attachment.sizeBytes,
      transferredBytes: input.attachment.sizeBytes,
    });
    const uploaded = await readJson(
      uploadResponse,
      parseUploadResponse,
      "Attachment upload failed",
    );
    if (uploaded.attachment.id !== staged.attachmentId || uploaded.sha256 !== hash) {
      throw new Error("Attachment upload integrity response is invalid");
    }
  } catch (cause) {
    await discardUpload(input.savedServerId, staged.uploadPath);
    throw cause;
  }
  return {
    attachmentId: staged.attachmentId,
    discard: async () => discardUpload(input.savedServerId, staged.uploadPath),
  };
}

async function discardUpload(savedServerId: SavedServerId, uploadPath: string): Promise<void> {
  try {
    await authorizedAttachmentFetch(savedServerId, uploadPath, { method: "DELETE" });
  } catch {
    // The server expires abandoned staging records; local removal must remain immediate.
  }
}

async function hashFile(
  file: File,
  input: ComposerAttachmentUploadInput,
  signal: AbortSignal,
): Promise<string> {
  const nativeDigest = await hashContentDocument(file.uri);
  if (nativeDigest !== null) {
    if (signal.aborted) throw new Error("Attachment upload was cancelled");
    if (nativeDigest.bytes !== input.attachment.sizeBytes) {
      throw new Error("Could not read the complete attachment");
    }
    input.onProgress({
      phase: "hashing",
      totalBytes: input.attachment.sizeBytes,
      transferredBytes: nativeDigest.bytes,
    });
    return nativeDigest.sha256;
  }
  const digest = sha256.create();
  const handle = file.open();
  let transferredBytes = 0;
  try {
    while (transferredBytes < input.attachment.sizeBytes) {
      if (signal.aborted) throw new Error("Attachment upload was cancelled");
      const chunk = handle.readBytes(
        Math.min(HASH_CHUNK_BYTES, input.attachment.sizeBytes - transferredBytes),
      );
      if (chunk.length === 0) throw new Error("Could not read the complete attachment");
      digest.update(chunk);
      transferredBytes += chunk.length;
      input.onProgress({
        phase: "hashing",
        totalBytes: input.attachment.sizeBytes,
        transferredBytes,
      });
      if (transferredBytes % HASH_YIELD_BYTES === 0) await yieldToEventLoop();
    }
  } finally {
    handle.close();
  }
  return bytesToHex(digest.digest());
}

async function readJson<Result>(
  response: Response,
  parse: (value: unknown) => Result,
  failure: string,
): Promise<Result> {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 160).trim();
    throw new Error(`${failure} (${response.status})${detail === "" ? "" : `: ${detail}`}`);
  }
  return parse(await response.json());
}

function parseStageResponse(value: unknown): V2AttachmentStageResponse {
  if (value === null || typeof value !== "object")
    throw new Error("Attachment stage response is invalid");
  const attachmentId = Reflect.get(value, "attachmentId");
  const expiresAt = Reflect.get(value, "expiresAt");
  const uploadPath = Reflect.get(value, "uploadPath");
  if (
    typeof attachmentId !== "string" ||
    attachmentId === "" ||
    !Number.isSafeInteger(expiresAt) ||
    (expiresAt as number) < 0 ||
    typeof uploadPath !== "string"
  ) {
    throw new Error("Attachment stage response is invalid");
  }
  requireAttachmentPath(uploadPath);
  return { attachmentId, expiresAt: expiresAt as number, uploadPath };
}

function parseUploadResponse(value: unknown): UploadResponse {
  if (value === null || typeof value !== "object")
    throw new Error("Attachment upload response is invalid");
  const attachment = Reflect.get(value, "attachment");
  const hash = Reflect.get(value, "sha256");
  const id =
    attachment === null || typeof attachment !== "object" ? null : Reflect.get(attachment, "id");
  if (
    typeof id !== "string" ||
    id === "" ||
    typeof hash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(hash)
  ) {
    throw new Error("Attachment upload response is invalid");
  }
  return { attachment: { id }, sha256: hash };
}

function registerTemporary(
  owned: Map<string, OwnedFile>,
  name: string,
  mediaType: string,
  value: string | Uint8Array,
): LocalComposerAttachment {
  requirePlatform();
  const safeName = safeUploadName(name);
  const file = draftFile(safeName);
  file.create({ intermediates: true, overwrite: false });
  try {
    file.write(value);
  } catch (cause) {
    deleteTemporary(file);
    throw cause;
  }
  return registerFile(owned, file, mediaType);
}

function registerFile(
  owned: Map<string, OwnedFile>,
  file: File,
  mediaType = file.type === "" ? "application/octet-stream" : file.type,
): LocalComposerAttachment {
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new Error("Selected attachment size is invalid");
  }
  const handle = `attachment-${globalThis.crypto.randomUUID()}`;
  const attachment = { handle, mediaType, name: safeUploadName(file.name), sizeBytes: file.size };
  owned.set(handle, { file });
  return attachment;
}

async function copyIntoDraftStorage(
  owned: Map<string, OwnedFile>,
  source: File,
): Promise<LocalComposerAttachment> {
  const target = draftFile(safeUploadName(source.name));
  try {
    await source.copy(target);
    return registerFile(
      owned,
      target,
      source.type === "" ? "application/octet-stream" : source.type,
    );
  } catch (cause) {
    deleteTemporary(target);
    throw cause;
  }
}

function restorePersisted(
  owned: Map<string, OwnedFile>,
  reference: PersistedLocalComposerAttachment,
): LocalComposerAttachment | null {
  const directory = draftDirectory();
  if (!reference.token.startsWith(`${directory.uri.replace(/\/$/u, "")}/`)) return null;
  const file = new File(reference.token);
  if (
    !file.exists ||
    !Number.isSafeInteger(file.size) ||
    file.size !== reference.sizeBytes ||
    safeUploadName(reference.name) !== reference.name ||
    reference.mediaType.length === 0 ||
    reference.mediaType.length > 256
  ) {
    deleteTemporary(file);
    return null;
  }
  return registerFile(owned, file, reference.mediaType);
}

function draftFile(name: string): File {
  return new File(draftDirectory(), `${globalThis.crypto.randomUUID()}-${name}`);
}

function draftDirectory(): Directory {
  const directory = new Directory(Paths.document, DRAFT_DIRECTORY_NAME);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

function pickerMimeTypes(kind: ComposerAttachmentPickKind): string {
  return kind === "image" ? "image/*" : "*/*";
}

function requirePlatform(): void {
  if (Platform.OS !== "android")
    throw new Error("Composer attachments are available on Android only");
}

function safeUploadName(value: string): string {
  const safeName = Array.from(value, safeFileNameCharacter).slice(-180).join("").trim();
  return safeName === "" ? "attachment" : safeName;
}

function safeFileNameCharacter(character: string): string {
  const code = character.codePointAt(0);
  if (
    character === "/" ||
    character === "\\" ||
    (code !== undefined && (code <= 31 || code === 127))
  ) {
    return "_";
  }
  return character;
}

function deleteTemporary(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup must not block removing a draft from the composer.
  }
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
