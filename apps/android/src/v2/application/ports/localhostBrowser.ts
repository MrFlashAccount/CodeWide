import type { V2TunnelCreateResponse } from "@codewide/sync-client/v2";

export interface LocalhostTunnelPort {
  createTunnel(port: number, ttlSeconds: number | null): Promise<V2TunnelCreateResponse>;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DEFAULT_BROWSER_TUNNEL_TTL_SECONDS = 3600;

interface LocalhostTarget {
  label: string;
  port: number;
  suffix: string;
}

export interface LocalhostBrowserSession extends LocalhostTarget {
  expiresAt: number;
  sourcePath: string;
  tunnelId: string;
}

export interface LocalhostBrowserHandlerInput {
  navigate(session: LocalhostBrowserSession): void | Promise<void>;
  ports: LocalhostTunnelPort;
  ttlSeconds?: number;
}

/**
 * Parses only explicit loopback URLs; non-loopback links remain normal links.
 * @testOnly Exposes loopback rejection boundaries to black-box URL regressions.
 */
export function parseLocalhostTarget(value: string): LocalhostTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.port === ""
  ) {
    return null;
  }
  const port = Number(url.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return null;
  return {
    label: `localhost:${port}`,
    port,
    suffix: `${url.pathname.replace(/^\//u, "")}${url.search}${url.hash}`,
  };
}

/**
 * Creates the device-bound bounded tunnel required to open a loopback Markdown link.
 * @testOnly Exposes tunnel construction and TTL validation to black-box regressions.
 */
export async function createLocalhostBrowserSession(
  ports: LocalhostTunnelPort,
  value: string,
  ttlSeconds = DEFAULT_BROWSER_TUNNEL_TTL_SECONDS,
): Promise<LocalhostBrowserSession | null> {
  const target = parseLocalhostTarget(value);
  if (target === null) return null;
  requireTtl(ttlSeconds);
  const tunnel = await ports.createTunnel(target.port, ttlSeconds);
  return sessionFrom(tunnel, target);
}

/** Returns a RichMarkdown-compatible handler that consumes only explicit loopback links. */
export function createLocalhostBrowserHandler(
  input: LocalhostBrowserHandlerInput,
): (value: string) => Promise<boolean> {
  return async (value) => {
    const session = await createLocalhostBrowserSession(
      input.ports,
      value,
      input.ttlSeconds ?? DEFAULT_BROWSER_TUNNEL_TTL_SECONDS,
    );
    if (session === null) return false;
    await input.navigate(session);
    return true;
  };
}

export function tunnelSourcePath(tunnelId: string, suffix: string): string {
  return `/v2/tunnels/${encodeURIComponent(tunnelId)}/${suffix}`;
}

function sessionFrom(
  tunnel: V2TunnelCreateResponse,
  target: LocalhostTarget,
): LocalhostBrowserSession {
  return {
    expiresAt: tunnel.expiresAt,
    label: target.label,
    port: target.port,
    sourcePath: `${tunnel.basePath}${target.suffix}`,
    suffix: target.suffix,
    tunnelId: tunnel.id,
  };
}

function requireTtl(value: number): void {
  if (!Number.isSafeInteger(value) || value < 30 || value > 3600) {
    throw new Error("Browser tunnel TTL must be between 30 and 3600 seconds");
  }
}
