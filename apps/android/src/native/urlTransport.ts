import type { CompanionTransport } from "./companionTransportContract";
import { fetchUrl } from "./urlFetch";

/** Directly reachable HTTP URLs. Web and Node read bodies through `fetch` and never download to files. */
export const urlTransport: CompanionTransport = {
  async download() {
    await Promise.resolve();
    throw new Error("File downloads are unavailable on this platform");
  },
  fetch: fetchUrl,
  async streamSource(uri, headers) {
    await Promise.resolve();
    return { headers, uri };
  },
};
