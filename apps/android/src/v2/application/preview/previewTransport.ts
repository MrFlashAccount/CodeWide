import type { SavedServerId } from "../../domain/ids";

export const MAX_DOCUMENT_PREVIEW_BYTES = 2 * 1024 * 1024;

export interface PreviewDocument {
  bodyBase64: string;
  contentType: string;
}

export interface PreviewStreamSource {
  headers: Record<string, string> | null;
  uri: string;
}

export type PreviewMode = "document" | "image" | "video" | "web";

export interface PreviewFileRequest {
  contentType: string;
  mode: PreviewMode;
  name: string;
  savedServerId: SavedServerId;
  sourceUrl: string;
}

export interface PreviewLocalFile {
  contentType: string;
  name: string;
  uri: string;
}

export interface PreviewTransport {
  exportFile(request: PreviewFileRequest): Promise<PreviewLocalFile>;
  materialize(request: PreviewFileRequest): Promise<PreviewLocalFile>;
  read(savedServerId: SavedServerId, sourceUrl: string): Promise<PreviewDocument>;
  save(request: PreviewFileRequest): Promise<PreviewLocalFile>;
  stream(
    savedServerId: SavedServerId,
    sourceUrl: string,
    mode: Exclude<PreviewMode, "document">,
  ): Promise<PreviewStreamSource>;
}
