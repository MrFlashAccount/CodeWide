import { observable, type Observable } from "@legendapp/state";
import type { RenderContentReference } from "@codewide/renderers";
import { readPrivateAssetText, type GetTransferAccess } from "../../../data/private-transfer";
import { stripTerminalControlSequences } from "../../../rendering/native-code-block";
import type { ContentDocumentPart } from "../../../services/content/contentRouteSession";
import {
  appendContentChunk,
  contentLabelRow,
  pendingContentRows,
  startContentPart,
  type ContentDocumentRow,
  type ContentPartCursor,
} from "./contentDocumentRows";
import { CONTENT_VIEW_CHUNK_BYTES } from "./contentLimits";

/** What follows the rows read so far. */
export type ContentDocumentTail =
  | { readonly kind: "complete" }
  /** More remains; the next chunk is read when the reader nears the end. */
  | { readonly kind: "more" }
  | { readonly kind: "loading" }
  | { readonly error: string; readonly kind: "failed" };

/** The rows a viewer shows and what follows them. */
export type ContentDocumentSnapshot = {
  readonly rows: readonly ContentDocumentRow[];
  readonly tail: ContentDocumentTail;
};

/** One chunk of a referenced field, starting at a UTF-8 character boundary. */
type ContentChunk = {
  /** Where the next chunk starts; the Companion aligns it to a character boundary. */
  readonly nextOffset: number;
  readonly text: string;
};

/** Reads the chunk of `reference` that starts at `offset`. */
export type ReadContentChunk = (
  reference: RenderContentReference,
  offset: number,
  signal: AbortSignal,
) => Promise<ContentChunk>;

/** Where the document's reading stands: the part being read and the next chunk's offset. */
type ReadPosition = {
  readonly cursor: ContentPartCursor;
  readonly offset: number;
};

/**
 * Reads one content document lazily: its inline parts at once, then each
 * referenced field chunk by chunk, the next chunk only when the viewer asks
 * for it. Chunks join through the part cursor, so a line split between
 * chunks is one row and the Companion's character-aligned offsets keep every
 * multibyte character whole. The viewer that constructs it owns its lifetime.
 */
export class ContentDocumentReader {
  readonly snapshot$: Observable<ContentDocumentSnapshot>;
  readonly #parts: readonly ContentDocumentPart[];
  readonly #read: ReadContentChunk;
  readonly #rows: ContentDocumentRow[] = [];
  readonly #sources: string[] = [];
  #position: ReadPosition | null = null;
  #controller: AbortController | null = null;
  #retainCount = 0;
  #disposed = false;

  constructor(parts: readonly ContentDocumentPart[], read: ReadContentChunk) {
    this.#parts = parts;
    this.#read = read;
    this.snapshot$ = observable<ContentDocumentSnapshot>({ rows: [], tail: { kind: "more" } });
    this.#enterPart(0);
    this.loadMore();
  }

  /** Reads the next chunk unless one is being read, the last failed, or none remains. */
  loadMore(): void {
    if (this.snapshot$.peek().tail.kind === "more") {
      this.#readNext();
    }
  }

  /** Reads the chunk whose read failed again. */
  retry(): void {
    if (this.snapshot$.peek().tail.kind === "failed") {
      this.#readNext();
    }
  }

  /** The whole document's text once every part is read; null before. */
  copyText(): string | null {
    if (this.snapshot$.peek().tail.kind !== "complete") {
      return null;
    }
    return this.#parts.length === 1
      ? (this.#sources[0] ?? "")
      : this.#parts
          .map((part, index) => `${part.label}\n${this.#sources[index] ?? ""}`)
          .join("\n\n");
  }

  /** Keeps the reader alive for one observer; the last release aborts its read. */
  retain(): () => void {
    this.#retainCount += 1;
    return () => {
      this.#retainCount -= 1;
      // A remount in the same commit retains again before this check runs.
      queueMicrotask(() => {
        if (this.#retainCount === 0) {
          this.#dispose();
        }
      });
    };
  }

  #dispose(): void {
    this.#disposed = true;
    this.#controller?.abort();
    this.#controller = null;
  }

  /** Starts part `index`, taking every inline part up to the next referenced one at once. */
  #enterPart(index: number): void {
    for (let current = index; current < this.#parts.length; current += 1) {
      const part = this.#parts[current];
      if (part === undefined) {
        break;
      }
      if (this.#parts.length > 1) {
        this.#rows.push(contentLabelRow(current, part.label));
      }
      const cursor = startContentPart(current, part.presentation);
      if (part.kind === "reference") {
        this.#sources[current] = "";
        this.#position = { cursor, offset: 0 };
        this.#publish({ kind: "more" });
        return;
      }
      this.#sources[current] = this.#source(part.presentation, part.text);
      this.#rows.push(...appendContentChunk(cursor, part.text, true).rows);
    }
    this.#position = null;
    this.#publish({ kind: "complete" });
  }

  #readNext(): void {
    const position = this.#position;
    const part = position === null ? undefined : this.#parts[position.cursor.part];
    if (this.#disposed || position === null || part?.kind !== "reference") {
      return;
    }
    if (position.offset >= part.reference.byteLength) {
      this.#apply(position, { nextOffset: part.reference.byteLength, text: "" }, part);
      return;
    }
    const controller = new AbortController();
    this.#controller = controller;
    this.#publish({ kind: "loading" });
    this.#read(part.reference, position.offset, controller.signal).then(
      (chunk) => {
        if (controller.signal.aborted) {
          return;
        }
        this.#controller = null;
        if (chunk.nextOffset <= position.offset) {
          this.#publish({ error: "Content returned an invalid range", kind: "failed" });
          return;
        }
        this.#apply(position, chunk, part);
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        this.#controller = null;
        this.#publish({
          error: error instanceof Error ? error.message : "Content unavailable",
          kind: "failed",
        });
      },
    );
  }

  #apply(
    position: ReadPosition,
    chunk: ContentChunk,
    part: Extract<ContentDocumentPart, { kind: "reference" }>,
  ): void {
    const complete = chunk.nextOffset >= part.reference.byteLength;
    const step = appendContentChunk(position.cursor, chunk.text, complete);
    const index = position.cursor.part;
    this.#sources[index] =
      `${this.#sources[index] ?? ""}${this.#source(part.presentation, chunk.text)}`;
    this.#rows.push(...step.rows);
    if (complete) {
      this.#enterPart(index + 1);
      return;
    }
    this.#position = { cursor: step.cursor, offset: chunk.nextOffset };
    this.#publish({ kind: "more" });
  }

  #source(presentation: ContentDocumentPart["presentation"], text: string): string {
    return presentation === "terminal" ? stripTerminalControlSequences(text) : text;
  }

  #publish(tail: ContentDocumentTail): void {
    const pending = this.#position === null ? [] : pendingContentRows(this.#position.cursor);
    // A new array per publication is the list's snapshot; the reader keeps appending its own.
    this.snapshot$.set({ rows: [...this.#rows, ...pending], tail });
  }
}

/** Reads referenced content through the Companion's private content route. */
export function companionContentChunks(
  getTransferAccess: GetTransferAccess | null,
): ReadContentChunk {
  return async (reference, offset, signal) => {
    if (getTransferAccess === null) {
      throw new Error("Content connection is unavailable");
    }
    const loaded = await readPrivateAssetText(
      { id: reference.id, kind: "content" },
      getTransferAccess,
      {
        accept: reference.contentType,
        limit: CONTENT_VIEW_CHUNK_BYTES,
        offset,
        signal,
      },
    );
    return { nextOffset: loaded.nextOffset, text: loaded.text };
  };
}
