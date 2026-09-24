type PairingBase = {
  type: "codewide-pairing";
  endpoint: string;
  pairingToken: string;
  expiresAt: number;
  displayName: string;
  emoji: string;
  tlsPinSha256: string;
  identityExpiresAt?: number;
};
export type CodeWidePairingPayload =
  | (PairingBase & { version: 1 })
  | (PairingBase & {
      version: 2;
      relayRouteId: string;
      relayTlsPinSha256: string;
    });

export function encodePairingPayload(payload: CodeWidePairingPayload): string {
  return JSON.stringify(validatePairingPayload(payload, Date.now())).replace(
    /[^\x20-\x7e]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function encodePairingLink(payload: CodeWidePairingPayload): string {
  const validated = validatePairingPayload(payload, Date.now());
  const url = new URL("codewide://pair");
  url.searchParams.set("v", String(validated.version));
  url.searchParams.set("e", validated.endpoint);
  url.searchParams.set("t", validated.pairingToken);
  url.searchParams.set("x", String(validated.expiresAt));
  url.searchParams.set("n", validated.displayName);
  url.searchParams.set("i", validated.emoji);
  url.searchParams.set("p", validated.tlsPinSha256);
  if (validated.identityExpiresAt !== undefined) url.searchParams.set("y", String(validated.identityExpiresAt));
  if (validated.version === 2) {
    url.searchParams.set("r", validated.relayRouteId);
    url.searchParams.set("q", validated.relayTlsPinSha256);
  }
  return url.toString();
}

export function parsePairingPayload(raw: string, now = Date.now()): CodeWidePairingPayload {
  if (raw.length > 4_096) throw new Error("Pairing QR is too large");
  const input = raw.trim();
  if (input.startsWith("codewide:") || input.startsWith("codexremote:")) {
    return parsePairingLink(input, now);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("This is not a CodeWide connection code");
  }
  return validatePairingPayload(parsed, now);
}

function parsePairingLink(raw: string, now: number): CodeWidePairingPayload {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid CodeWide connection link");
  }
  if ((url.protocol !== "codewide:" && url.protocol !== "codexremote:") || url.hostname !== "pair" || (url.pathname !== "" && url.pathname !== "/") || url.hash !== "") {
    throw new Error("Unsupported CodeWide connection link");
  }
  const pin = url.searchParams.get("p");
  const identityExpiry = url.searchParams.get("y");
  return validatePairingPayload({
    type: "codewide-pairing",
    version: Number(url.searchParams.get("v")),
    endpoint: url.searchParams.get("e"),
    pairingToken: url.searchParams.get("t"),
    expiresAt: Number(url.searchParams.get("x")),
    displayName: url.searchParams.get("n"),
    emoji: url.searchParams.get("i"),
    tlsPinSha256: pin,
    ...(identityExpiry === null ? {} : { identityExpiresAt: Number(identityExpiry) }),
    relayRouteId: url.searchParams.get("r"),
    relayTlsPinSha256: url.searchParams.get("q"),
  }, now);
}

function validatePairingPayload(value: unknown, now: number): CodeWidePairingPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid pairing payload");
  const field = (name: string): unknown => Reflect.get(value, name);
  const version = field("version");
  if ((field("type") !== "codewide-pairing" && field("type") !== "codex-remote-pairing") || (version !== 1 && version !== 2)) {
    throw new Error("Unsupported pairing QR");
  }
  const expiresAt = field("expiresAt");
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt)) throw new Error("Invalid pairing expiry");
  if (expiresAt <= now) throw new Error("Pairing QR has expired");
  if (expiresAt > now + 10 * 60_000) throw new Error("Pairing QR expiry is outside the allowed window");
  const pairingToken = field("pairingToken");
  if (typeof pairingToken !== "string" || pairingToken.length < 32 || pairingToken.length > 512) {
    throw new Error("Invalid pairing token");
  }
  const displayName = field("displayName");
  if (typeof displayName !== "string" || displayName.trim().length < 1 || displayName.trim().length > 80) {
    throw new Error("Invalid server name");
  }
  const emoji = field("emoji");
  if (typeof emoji !== "string" || emoji.trim().length < 1 || emoji.trim().length > 16) {
    throw new Error("Invalid server emoji");
  }
  const rawEndpoint = field("endpoint");
  if (typeof rawEndpoint !== "string") throw new Error("Invalid pairing endpoint");
  const endpoint = validateEndpoint(rawEndpoint, version === 2);
  const tlsPinSha256 = field("tlsPinSha256");
  if (typeof tlsPinSha256 !== "string" || !/^sha256\/[A-Za-z0-9+/]{43}=$/.test(tlsPinSha256)) {
    throw new Error("Invalid TLS certificate pin");
  }
  const identityExpiresAt = field("identityExpiresAt");
  if (identityExpiresAt !== undefined && (
    typeof identityExpiresAt !== "number"
    || !Number.isSafeInteger(identityExpiresAt)
    || identityExpiresAt <= now
  )) throw new Error("Invalid companion identity expiry");
  const common = {
    type: "codewide-pairing",
    endpoint,
    pairingToken,
    expiresAt,
    displayName: displayName.trim(),
    emoji: emoji.trim(),
    tlsPinSha256,
    ...(identityExpiresAt === undefined ? {} : { identityExpiresAt }),
  } as const;
  if (version === 1) return { ...common, version: 1 };
  const relayRouteId = field("relayRouteId");
  const relayTlsPinSha256 = field("relayTlsPinSha256");
  if (typeof relayRouteId !== "string" || !/^[a-f0-9]{64}$/u.test(relayRouteId)) {
    throw new Error("Invalid Relay route");
  }
  if (typeof relayTlsPinSha256 !== "string" || !/^sha256\/[A-Za-z0-9+/]{43}=$/u.test(relayTlsPinSha256)) {
    throw new Error("Invalid Relay certificate pin");
  }
  return { ...common, version: 2, relayRouteId, relayTlsPinSha256 };
}

function validateEndpoint(raw: string, pinnedRelay: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid pairing endpoint");
  }
  if (url.protocol !== "wss:" && url.protocol !== "ws:") throw new Error("Pairing endpoint must use WebSocket");
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "10.0.2.2";
  const relay = /^\/c\/[a-f0-9]{64}\/v1\/sync$/u.test(url.pathname);
  if (pinnedRelay && (url.protocol !== "wss:" || url.pathname !== "/v1/sync")) {
    throw new Error("Pinned Relay endpoint must use WSS and /v1/sync");
  }
  if (url.protocol === "ws:" && !local && !relay) throw new Error("Remote pairing endpoint must use WSS or an explicit inner-TLS relay route");
  const pathname = url.pathname === "/" || url.pathname === "" ? "/v1/sync" : url.pathname;
  if ((pathname !== "/v1/sync" && !relay) || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("Invalid pairing endpoint shape");
  }
  return (pathname === url.pathname ? url : new URL(pathname, url)).toString();
}
