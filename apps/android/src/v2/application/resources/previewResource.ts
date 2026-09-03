import type {
  PreviewDocument,
  PreviewFileRequest,
  PreviewLocalFile,
  PreviewMode,
  PreviewStreamSource,
  PreviewTransport,
} from "../preview/previewTransport";
import type { SavedServerId } from "../../domain/ids";
import { ObservableResource } from "./resource";

export interface PreviewValue {
  document: PreviewDocument | null;
  stream: PreviewStreamSource | null;
}

const EMPTY: PreviewValue = { document: null, stream: null };

export class PreviewResource extends ObservableResource<PreviewValue> {
  readonly #transport: PreviewTransport;
  readonly #savedServerId: SavedServerId;
  readonly #sourceUrl: string;
  readonly #mode: PreviewMode;
  #revision = 0;

  constructor(
    transport: PreviewTransport,
    savedServerId: SavedServerId,
    sourceUrl: string,
    mode: PreviewMode,
  ) {
    super(EMPTY);
    this.#transport = transport;
    this.#savedServerId = savedServerId;
    this.#sourceUrl = sourceUrl;
    this.#mode = mode;
    this.refresh().catch(() => undefined);
  }

  async refresh(): Promise<void> {
    const revision = this.#revision + 1;
    this.#revision = revision;
    this.publish({ status: "loading", value: this.snapshot().value });
    try {
      const document =
        this.#mode === "document"
          ? await this.#transport.read(this.#savedServerId, this.#sourceUrl)
          : null;
      const stream =
        this.#mode === "document"
          ? null
          : await this.#transport.stream(this.#savedServerId, this.#sourceUrl, this.#mode);
      if (revision !== this.#revision) return;
      this.publish({ status: "ready", value: { document, stream } });
    } catch (cause) {
      if (revision !== this.#revision) return;
      this.publish({
        message: previewFailureMessage(cause),
        status: "error",
        value: this.snapshot().value,
      });
    }
  }

  materialize(name: string, contentType: string): Promise<PreviewLocalFile> {
    return this.#transport.materialize(this.#fileRequest(name, contentType));
  }

  save(name: string, contentType: string): Promise<PreviewLocalFile> {
    return this.#transport.save(this.#fileRequest(name, contentType));
  }

  exportFile(name: string, contentType: string): Promise<PreviewLocalFile> {
    return this.#transport.exportFile(this.#fileRequest(name, contentType));
  }

  #fileRequest(name: string, contentType: string): PreviewFileRequest {
    return {
      contentType,
      mode: this.#mode,
      name,
      savedServerId: this.#savedServerId,
      sourceUrl: this.#sourceUrl,
    };
  }
}

function previewFailureMessage(cause: unknown): string {
  if (!(cause instanceof Error) || cause.message === "") return "Could not open this attachment";
  if (/\b(401|403)\b/u.test(cause.message)) {
    return "Attachment access expired. Try again to reconnect securely.";
  }
  if (/\b404\b/u.test(cause.message)) return "This attachment is no longer available.";
  return cause.message;
}
