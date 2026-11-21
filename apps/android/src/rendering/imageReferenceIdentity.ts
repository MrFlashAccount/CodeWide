type ImageReference = { readonly key: string; readonly value: string };

const byOwner = new WeakMap<Readonly<Record<string, unknown>>, ImageReference>();
// Index by length only. Neither secret URLs nor inline bytes are keys. A fixed number of
// buckets lets Hermes reclaim source strings without depending on FinalizationRegistry.
const buckets = new Map<number, Set<WeakRef<ImageReference>>>();
const BUCKET_COUNT = 256;
let nextId = 0;

/** A process-local identity shared by equal references while any of their source owners lives. */
export function imageReferenceIdentity(
  owner: Readonly<Record<string, unknown>>,
  value: string,
  model: Readonly<Record<string, unknown>> = owner,
): string {
  const known = byOwner.get(model);
  const entry = known?.value === value ? known : findOrCreateReference(value);
  if (known !== entry) {
    byOwner.set(model, entry);
  }
  if (owner !== model) {
    byOwner.set(owner, entry);
  }
  return entry.key;
}

function findOrCreateReference(value: string): ImageReference {
  const index = value.length % BUCKET_COUNT;
  let bucket = buckets.get(index);
  if (bucket === undefined) {
    bucket = new Set();
    buckets.set(index, bucket);
  }
  for (const weak of bucket) {
    const entry = weak.deref();
    if (entry === undefined) {
      bucket.delete(weak);
    } else if (entry.value === value) {
      return entry;
    }
  }
  nextId += 1;
  const entry = { key: String(nextId), value };
  bucket.add(new WeakRef(entry));
  return entry;
}

/** Scoped paths can change contents at a new editor revision without changing their name. */
export function scopedImageReferenceKey(
  source: { readonly cacheRevision?: string; readonly path: string; readonly rootId: string },
  model: Readonly<Record<string, unknown>> = source,
): string {
  const location = JSON.stringify([source.rootId, source.path, source.cacheRevision ?? "0"]);
  return `scoped:${imageReferenceIdentity(source, location, model)}`;
}
