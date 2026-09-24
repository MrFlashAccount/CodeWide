/** Disk bytes shared by every attachment format, including in-flight reservations. */
export const ATTACHMENT_CACHE_BYTES = 1024 * 1024 * 1024;

export interface CachedAttachment {
  bytes: number;
  key: string;
  scopeKey?: string;
  touchedAt: number;
}

/** Platform storage publishes a completed file atomically; partial files are never readable. */
export interface AttachmentStorage {
  exists: (key: string, bytes: number) => Promise<boolean>;
  remove: (key: string) => Promise<void>;
  restore: () => Promise<CachedAttachment[]>;
  touch: (entry: CachedAttachment) => Promise<void>;
  uri: (key: string) => string;
}

export interface AttachmentLease {
  release: () => void;
  uri: string;
}

export interface AttachmentAdmission {
  bytes: number;
  scopeKey: string | undefined;
}

interface ResidentEntry {
  readers: number;
  value: CachedAttachment;
}

/** Owns admission, LRU eviction and readers. Payloads never enter this owner's JS heap. */
export class AttachmentDiskCache {
  private readonly entries = new Map<string, ResidentEntry>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly blockedScopes = new Set<string>();
  private initialized: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private bytes = 0;
  private readonly storage: AttachmentStorage;
  private readonly now: () => number;
  private readonly limit: number;

  constructor(storage: AttachmentStorage, now: () => number, limit = ATTACHMENT_CACHE_BYTES) {
    this.storage = storage;
    this.now = now;
    this.limit = limit;
  }

  /** Null means bypass the optional cache; a large attachment must remain readable. */
  async acquire(
    key: string,
    admission: AttachmentAdmission,
    write: () => Promise<void>,
  ): Promise<AttachmentLease | null> {
    if (!this.canAdmit(admission)) {
      return null;
    }
    if (this.initialized === null) {
      const initialization = this.initialize();
      this.initialized = initialization;
      void initialization.catch(() => {
        if (this.initialized === initialization) {
          this.initialized = null;
        }
      });
    }
    await this.initialized;
    const admitted = await this.exclusive(async () => {
      if (!this.canAdmit(admission)) {
        return null;
      }
      const entry = await this.validExistingEntry(key, admission.bytes);
      if (entry !== undefined) {
        entry.value.touchedAt = this.now();
        if (!this.pending.has(key)) {
          await this.storage.touch(entry.value);
        }
        entry.readers += 1;
        return { entry, ready: this.pending.get(key) ?? Promise.resolve() };
      }
      if (!(await this.makeRoom(admission.bytes))) {
        return null;
      }
      const created: ResidentEntry = {
        readers: 1,
        value: {
          bytes: admission.bytes,
          key,
          touchedAt: this.now(),
          ...(admission.scopeKey === undefined ? {} : { scopeKey: admission.scopeKey }),
        },
      };
      this.entries.set(key, created);
      this.bytes += admission.bytes;
      // Download outside the metadata queue; one failed generation cleans itself up exactly once.
      const operation = Promise.resolve()
        .then(write)
        .then(async () =>
          this.exclusive(async () => {
            await this.storage.touch(created.value);
            this.pending.delete(key);
          }),
        )
        .catch(async (error: unknown) => {
          await this.exclusive(async () => {
            if (this.entries.get(key) === created) {
              await this.remove(created);
            }
            this.pending.delete(key);
          });
          throw error;
        });
      this.pending.set(key, operation);
      void operation.catch(() => undefined);
      return { entry: created, ready: operation };
    });
    if (admitted === null) {
      return null;
    }
    await admitted.ready;
    if (!this.canAdmit(admission)) {
      admitted.entry.readers -= 1;
      return null;
    }
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        admitted.entry.readers -= 1;
      },
      uri: this.storage.uri(key),
    };
  }

  private canAdmit(admission: AttachmentAdmission): boolean {
    return (
      Number.isSafeInteger(admission.bytes) &&
      admission.bytes >= 0 &&
      admission.bytes <= this.limit &&
      (admission.scopeKey === undefined || !this.blockedScopes.has(admission.scopeKey))
    );
  }

  private async validExistingEntry(key: string, bytes: number): Promise<ResidentEntry | undefined> {
    const entry = this.entries.get(key);
    if (entry === undefined || this.pending.has(key) || (await this.storage.exists(key, bytes))) {
      return entry;
    }
    await this.remove(entry);
    return undefined;
  }

  /** A native image/player retains a local URI while it owns the file. */
  retain(uri: string): () => void {
    for (const entry of this.entries.values()) {
      if (this.storage.uri(entry.value.key) !== uri) {
        continue;
      }
      entry.readers += 1;
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        entry.readers -= 1;
      };
    }
    return () => undefined;
  }

  /** Removes the deleted server's bytes and legacy entries with no owner metadata. */
  async deleteScope(scopeKey: string): Promise<void> {
    this.blockedScopes.add(scopeKey);
    if (this.initialized === null) {
      const initialization = this.initialize();
      this.initialized = initialization;
      void initialization.catch(() => {
        if (this.initialized === initialization) {
          this.initialized = null;
        }
      });
    }
    await this.initialized;
    await Promise.all(
      [...this.pending.values()].map(async (operation) => {
        await operation.catch(() => undefined);
      }),
    );
    await this.exclusive(async () => {
      for (const entry of this.entries.values()) {
        if (entry.value.scopeKey === scopeKey || entry.value.scopeKey === undefined) {
          await this.remove(entry);
        }
      }
    });
  }

  private async initialize(): Promise<void> {
    this.entries.clear();
    this.bytes = 0;
    for (const value of await this.storage.restore()) {
      this.entries.set(value.key, { readers: 0, value });
      this.bytes += value.bytes;
    }
    await this.makeRoom(0);
  }

  private async makeRoom(incoming: number): Promise<boolean> {
    if (this.bytes + incoming <= this.limit) {
      return true;
    }
    const oldest = [...this.entries.values()].sort((a, b) => a.value.touchedAt - b.value.touchedAt);
    for (const entry of oldest) {
      if (entry.readers > 0 || this.pending.has(entry.value.key)) {
        continue;
      }
      await this.remove(entry);
      if (this.bytes + incoming <= this.limit) {
        return true;
      }
    }
    return false;
  }

  private async remove(entry: ResidentEntry): Promise<void> {
    await this.storage.remove(entry.value.key);
    this.entries.delete(entry.value.key);
    this.bytes -= entry.value.bytes;
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
