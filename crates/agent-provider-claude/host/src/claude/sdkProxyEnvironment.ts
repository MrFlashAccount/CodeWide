/**
 * Resolves standard proxy variables from the user's Claude settings without
 * loading the rest of those settings into CodeWide queries. The SDK owns the
 * user/managed precedence rules; this adapter validates only the proxy values
 * that may cross into the query process environment.
 */

import type { AgentSdk } from "./sdkModule.js";

const PROXY_ENVIRONMENT_NAMES = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const;

type ProxyEnvironmentName = (typeof PROXY_ENVIRONMENT_NAMES)[number];

/** Proxy variables CodeWide may forward from Claude's effective settings. */
export type ProxyEnvironment = Readonly<Partial<Record<ProxyEnvironmentName, string>>>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Extracts standard proxy variables from `effective.env`.
 *
 * Missing `env` means no configured overrides. An invalid selected proxy
 * value is a startup error; unrelated environment entries are never forwarded.
 */
export function proxyEnvironmentFromResolvedSettings(value: unknown): ProxyEnvironment {
  if (!isRecord(value)) {
    throw new Error("resolved Claude settings must be an object");
  }
  const effective: unknown = Reflect.get(value, "effective");
  if (!isRecord(effective)) {
    throw new Error("resolved Claude settings effective value must be an object");
  }
  const env: unknown = Reflect.get(effective, "env");
  if (env === undefined) {
    return {};
  }
  if (!isRecord(env)) {
    throw new Error("resolved Claude settings environment must be an object");
  }
  const entries: [ProxyEnvironmentName, string][] = [];
  for (const name of PROXY_ENVIRONMENT_NAMES) {
    if (!Object.hasOwn(env, name)) {
      continue;
    }
    const entry: unknown = Reflect.get(env, name);
    if (typeof entry !== "string") {
      throw new Error("resolved Claude proxy environment values must be strings");
    }
    entries.push([name, entry]);
  }
  return Object.fromEntries(entries);
}

/** Resolves the startup snapshot of user and managed Claude proxy settings. */
export async function resolveUserProxyEnvironment(
  sdk: Pick<AgentSdk, "resolveSettings">,
): Promise<ProxyEnvironment> {
  const resolved: unknown = await sdk.resolveSettings({ settingSources: ["user"] });
  return proxyEnvironmentFromResolvedSettings(resolved);
}
