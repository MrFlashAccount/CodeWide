import type { CompanionTransportInit } from "./companionTransportContract";

/** Sends a request through the platform `fetch`; file bodies require a native transport. */
export async function fetchUrl(uri: string, init: CompanionTransportInit = {}): Promise<Response> {
  const { body, headers, method, signal } = init;
  if (body !== undefined && typeof body !== "string") {
    throw new Error("File request bodies require the native Companion transport");
  }
  return fetch(uri, {
    ...(body === undefined ? {} : { body }),
    ...(headers === undefined ? {} : { headers }),
    ...(method === undefined ? {} : { method }),
    ...(signal === undefined ? {} : { signal }),
  });
}
