import type { NativePortForwardProfile } from "../native/native-transport";

export type LoopbackLinkTarget = {
  protocol: "http:" | "https:";
  remotePort: number;
  suffix: string;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseLoopbackLink(href: string): LoopbackLinkTarget | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:")
    || !LOOPBACK_HOSTS.has(url.hostname.toLocaleLowerCase())
    || url.username !== ""
    || url.password !== "") return null;

  const remotePort = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65_535) return null;
  return {
    protocol: url.protocol,
    remotePort,
    suffix: `${url.pathname}${url.search}${url.hash}`,
  };
}

export function forwardedLoopbackUrl(target: LoopbackLinkTarget, profile: NativePortForwardProfile): string {
  if (profile.localPort === null) throw new Error("The phone port is not ready");
  return `${target.protocol}//127.0.0.1:${profile.localPort}${target.suffix}`;
}
