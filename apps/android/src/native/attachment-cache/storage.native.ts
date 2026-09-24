import {
  cacheDirectory,
  deleteAsync,
  getInfoAsync,
  makeDirectoryAsync,
  moveAsync,
  readAsStringAsync,
  readDirectoryAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";
import type { AttachmentStorage, CachedAttachment } from "./disk-cache";

const KEY = /^[a-f0-9]{64}$/u;

/** Only digests and byte/access counters are persisted alongside attachment bytes. */
export class ExpoAttachmentStorage implements AttachmentStorage {
  private root(): string {
    if (cacheDirectory === null) {
      throw new Error("Attachment cache is unavailable");
    }
    return `${cacheDirectory}codewide-attachments-v1/`;
  }

  uri(key: string): string {
    if (!KEY.test(key)) {
      throw new Error("Invalid attachment cache key");
    }
    return `${this.root()}${key}.bin`;
  }

  async restore(): Promise<CachedAttachment[]> {
    await makeDirectoryAsync(this.root(), { intermediates: true });
    const restored: CachedAttachment[] = [];
    const names = await readDirectoryAsync(this.root());
    const valid = new Set<string>();
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const key = name.slice(0, -5);
      if (!KEY.test(key)) {
        continue;
      }
      try {
        const value: unknown = JSON.parse(await readAsStringAsync(`${this.root()}${name}`));
        const entry = parseEntry(value, key);
        if (entry !== null && (await this.exists(key, entry.bytes))) {
          restored.push(entry);
          valid.add(`${key}.json`);
          valid.add(`${key}.bin`);
        }
      } catch {
        // Interrupted metadata publication or OS cache eviction is a cache miss.
      }
    }
    for (const name of names) {
      if (!valid.has(name)) {
        await deleteAsync(`${this.root()}${name}`, { idempotent: true });
      }
    }
    // The obsolete image cache has no retention owner. A cold runtime holds no URIs into it.
    await deleteAsync(`${String(cacheDirectory)}codex-remote-private-images-v2`, {
      idempotent: true,
    });
    return restored;
  }

  async exists(key: string, bytes: number): Promise<boolean> {
    const info = await getInfoAsync(this.uri(key));
    return info.exists && !info.isDirectory && info.size === bytes;
  }

  async touch(entry: CachedAttachment): Promise<void> {
    const target = `${this.root()}${entry.key}.json`;
    await writeAsStringAsync(`${target}.partial`, JSON.stringify(entry));
    await moveAsync({ from: `${target}.partial`, to: target });
  }

  async remove(key: string): Promise<void> {
    await deleteAsync(this.uri(key), { idempotent: true });
    await deleteAsync(`${this.root()}${key}.json`, { idempotent: true });
    await deleteAsync(`${this.uri(key)}.partial`, { idempotent: true });
  }
}

function parseEntry(value: unknown, key: string): CachedAttachment | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const bytes: unknown = Reflect.get(value, "bytes");
  const touchedAt: unknown = Reflect.get(value, "touchedAt");
  const scopeKey: unknown = Reflect.get(value, "scopeKey");
  if (
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    typeof touchedAt !== "number" ||
    !Number.isFinite(touchedAt)
  ) {
    return null;
  }
  return {
    bytes,
    key,
    touchedAt,
    ...parseScopeKey(scopeKey),
  };
}

function parseScopeKey(value: unknown): { scopeKey?: string } {
  return typeof value === "string" && KEY.test(value) ? { scopeKey: value } : {};
}
