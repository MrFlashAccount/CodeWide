import { randomUUID } from "expo-crypto";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { checkAborted } from "../native/check-aborted";
import { urlTransport } from "../native/urlTransport";
import {
  resolvePrivateAssetRequest,
  type GetTransferAccess,
  type PrivateAssetSource,
} from "../data/private-transfer";
import { recoverPrivateAsset } from "./private-asset-recovery";

const HTTP_OK = 200;
let staging: Promise<string> | null = null;

async function createStagingDirectory(): Promise<string> {
  const fs = await import("expo-file-system/legacy");
  if (fs.cacheDirectory === null) {
    throw new Error("Trace storage is unavailable");
  }
  const root = fs.cacheDirectory + "codewide-trace-previews/";
  // No preview or query survives a cold runtime. Recover files left by Android killing it.
  await fs.deleteAsync(root, { idempotent: true });
  await fs.makeDirectoryAsync(root, { intermediates: true });
  return root;
}

async function stagingDirectory(): Promise<string> {
  staging ??= createStagingDirectory().catch((error: unknown) => {
    staging = null;
    throw error;
  });
  return staging;
}

/** Stages original bytes through their owning transport, including relay-only connections.
 * The file belongs to this preview query and is removed on cancellation or eviction. */
export async function stagePerfettoFile({
  client,
  getAccess,
  key,
  signal,
  source,
}: {
  readonly client: QueryClient;
  readonly getAccess: GetTransferAccess;
  readonly key: QueryKey;
  readonly signal: AbortSignal;
  readonly source: PrivateAssetSource;
}): Promise<string> {
  const fs = await import("expo-file-system/legacy");
  checkAborted(signal);
  const query = client.getQueryCache().find({ exact: true, queryKey: key });
  if (query === undefined) {
    throw new Error("Trace storage is unavailable");
  }
  const uri = (await stagingDirectory()) + randomUUID();
  checkAborted(signal);
  try {
    if (source.kind === "direct" && /^(?:file|content):/u.test(source.uri)) {
      await fs.copyAsync({ from: source.uri, to: uri });
    } else {
      await recoverPrivateAsset(async (refresh) => {
        checkAborted(signal);
        const request =
          source.kind === "direct"
            ? { headers: source.headers ?? {}, transport: urlTransport, uri: source.uri }
            : await resolvePrivateAssetRequest(source, getAccess, { forceRefresh: refresh });
        const result = await request.transport.download(
          request.uri,
          { headers: request.headers, signal },
          { append: false, uri },
        );
        if (result.status !== HTTP_OK) {
          throw new Error(`Trace download failed (${String(result.status)})`);
        }
        return { headers: {}, uri };
      }, null);
    }
    checkAborted(signal);
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.type === "removed" && event.query === query) {
        unsubscribe();
        void fs.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      }
    });
    return uri;
  } catch (error) {
    await fs.deleteAsync(uri, { idempotent: true });
    throw error;
  }
}
