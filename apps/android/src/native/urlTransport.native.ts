import type { CompanionTransport } from "./companionTransportContract";
import { fetchUrl } from "./urlFetch";

/** Directly reachable HTTP URLs, downloaded by Expo's native file client. */
export const urlTransport: CompanionTransport = {
  async download(uri, init, destination) {
    if (destination.append) {
      throw new Error("Appending downloads requires the native Companion transport");
    }
    const { downloadAsync } = await import("expo-file-system/legacy");
    const downloaded = await downloadAsync(uri, destination.uri, {
      cache: false,
      headers: init.headers,
    });
    return { headers: new Headers(downloaded.headers), status: downloaded.status };
  },
  fetch: fetchUrl,
  async streamSource(uri, headers) {
    await Promise.resolve();
    return { headers, uri };
  },
};
