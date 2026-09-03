import { safeMarkdownImageUri } from "./imageSource";
import type {
  MarkdownImageReference,
  RenderingImageItem,
  RenderingImageSource,
} from "./renderingCapabilities";

export type RenderingImageResolver = (
  reference: string,
) => RenderingImageSource | null | Promise<RenderingImageSource | null>;

export class ResolvedImageResource {
  readonly #listeners = new Set<() => void>();
  readonly #items = new Map<string, RenderingImageItem>();
  #snapshot: RenderingImageItem[] = [];

  constructor(references: MarkdownImageReference[], resolver: RenderingImageResolver | undefined) {
    references.forEach((reference, order) => {
      if (resolver === undefined) this.#commit(reference, order, null);
      else this.#resolve(reference, order, resolver);
    });
    this.#publish();
  }

  snapshot = (): RenderingImageItem[] => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #resolve(
    reference: MarkdownImageReference,
    order: number,
    resolver: RenderingImageResolver,
  ): void {
    let pending: RenderingImageSource | null | Promise<RenderingImageSource | null>;
    try {
      pending = resolver(reference.reference);
    } catch {
      this.#commit(reference, order, null);
      return;
    }
    if (!(pending instanceof Promise)) {
      this.#commit(reference, order, pending);
      return;
    }
    void Promise.resolve(pending)
      .then((source) => {
        this.#commit(reference, order, source);
      })
      .catch(() => this.#commit(reference, order, null));
  }

  #commit(
    reference: MarkdownImageReference,
    order: number,
    source: RenderingImageSource | null,
  ): void {
    const fallback = safeMarkdownImageUri(reference.reference);
    const resolved = source ?? (fallback === null ? null : { uri: fallback });
    if (resolved === null) return;
    this.#items.set(reference.id, imageItem(reference, order, resolved));
    this.#publish();
  }

  #publish(): void {
    this.#snapshot = [...this.#items.values()].toSorted((left, right) => left.order - right.order);
    for (const listener of this.#listeners) listener();
  }
}

function imageItem(
  reference: MarkdownImageReference,
  order: number,
  source: RenderingImageSource,
): RenderingImageItem {
  return { ...reference, order, source };
}
