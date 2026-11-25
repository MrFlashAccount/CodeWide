import type { QueryExecuteOptions } from "@tanstack/react-query";
import {
  findForgeLinkTargets,
  type LinkServer,
  type ForgeLinkTarget,
} from "../data/forgeLinkTargets";
import { forgeLinkAuthority } from "../data/forgeRuntime";

const LINK_INTENT_FRESH_MS = 10_000;

/** Short-lived, memory-only resolution shared between a tap and its account picker. */
export function forgeLinkOptions(
  servers: readonly LinkServer[],
  url: URL,
  origin: string | null,
): QueryExecuteOptions<readonly ForgeLinkTarget[]> {
  return {
    networkMode: "always",
    queryFn: async () => findForgeLinkTargets({ origin, servers, url }, forgeLinkAuthority),
    queryKey: [
      "forgeLink",
      origin,
      url.href,
      servers.map((server) => [
        server.id,
        server.enabled,
        server.state,
        server.displayName,
        server.iconId,
      ]),
    ],
    retry: false,
    staleTime: LINK_INTENT_FRESH_MS,
  };
}
