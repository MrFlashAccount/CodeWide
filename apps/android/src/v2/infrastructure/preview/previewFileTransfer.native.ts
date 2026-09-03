import { Directory, File, Paths } from "expo-file-system";
import { NativeModules, Platform } from "react-native";

import type {
  PreviewFileRequest,
  PreviewLocalFile,
  PreviewStreamSource,
} from "../../application/preview/previewTransport";

interface PreviewFileNativeBridge {
  openDocument(uri: string, mimeType: string | null): Promise<void>;
}

interface PreviewFileTransferInput {
  request: PreviewFileRequest;
  source: PreviewStreamSource;
}

// WHY: React Native's native-module registry cannot express the optional app bridge shape.
const bridge = NativeModules["CodeWideNative"] as PreviewFileNativeBridge | undefined;

export async function materializePreviewFile(
  input: PreviewFileTransferInput,
): Promise<PreviewLocalFile> {
  const { request, source } = input;
  if (localSource(source.uri)) {
    return { contentType: request.contentType, name: safeFilename(request.name), uri: source.uri };
  }
  const directory = new Directory(Paths.cache, "codewide-v2-previews");
  directory.create({ idempotent: true, intermediates: true });
  // Saved servers are separate trust domains. Keep their cache namespaces
  // separate even if Android later reuses the same loopback port and path.
  const filename = `${sourceKey(`${request.savedServerId}\u0000${source.uri}`)}-${safeFilename(request.name)}`;
  const destination = new File(directory, filename);
  const options =
    source.headers === null ? { idempotent: true } : { headers: source.headers, idempotent: true };
  const file = await File.downloadFileAsync(source.uri, destination, options);
  return { contentType: request.contentType, name: filename, uri: file.uri };
}

export async function savePreviewFile(input: PreviewFileTransferInput): Promise<PreviewLocalFile> {
  const { request, source } = input;
  const directory = await Directory.pickDirectoryAsync();
  const filename = safeFilename(request.name);
  const destination = directory.createFile(filename, normalizedContentType(request.contentType));
  try {
    if (destination.name !== filename) {
      throw new Error("The selected folder changed the attachment filename");
    }
    if (localSource(source.uri)) {
      await new File(source.uri).copy(destination);
    } else {
      await File.downloadFileAsync(
        source.uri,
        destination,
        source.headers === null ? undefined : { headers: source.headers },
      );
    }
    return { contentType: request.contentType, name: filename, uri: destination.uri };
  } catch (cause) {
    deleteBestEffort(destination);
    throw cause;
  }
}

export async function exportPreviewFile(
  input: PreviewFileTransferInput,
): Promise<PreviewLocalFile> {
  if (bridge === undefined || Platform.OS !== "android") {
    throw new Error("Opening exported files is available on Android only");
  }
  const saved = await savePreviewFile(input);
  await bridge.openDocument(saved.uri, normalizedContentType(saved.contentType));
  return saved;
}

function safeFilename(value: string): string {
  const filename = value
    .split(/[\\/]/u)
    .at(-1)
    ?.split("")
    .map((character) => (safeFilenameCharacter(character) ? character : "-"))
    .join("")
    .replaceAll(/[-]+/gu, "-")
    .replace(/^\.+$/u, "")
    .slice(0, 180);
  return filename === undefined || filename === "" ? "attachment" : filename;
}

function normalizedContentType(value: string): string | null {
  const contentType = value.split(";", 1)[0]?.trim() ?? "";
  return contentType === "" ? null : contentType;
}

function sourceKey(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function safeFilenameCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 32 && !String.raw`\/:*?"<>|`.includes(character);
}

function localSource(value: string): boolean {
  return value.startsWith("file:") || value.startsWith("content:");
}

function deleteBestEffort(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // A provider can reject cleanup after the download already failed. The
    // original transfer error remains the actionable result.
  }
}
