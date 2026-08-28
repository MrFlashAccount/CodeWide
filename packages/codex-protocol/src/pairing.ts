export type CodeWidePairingPayload = {
  type: "codewide-pairing";
  version: 1;
  endpoint: string;
  pairingToken: string;
  expiresAt: number;
  displayName: string;
  emoji: string;
  tlsPinSha256: string;
  identityExpiresAt?: number;
};

export function encodePairingPayload(payload: CodeWidePairingPayload): string {
  return JSON.stringify(validatePairingPayload(payload, Date.now())).replace(
    /[^\x20-\x7e]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function encodePairingLink(payload: CodeWidePairingPayload): string {
  const validated = validatePairingPayload(payload, Date.now());
  const url = new URL("codewide://pair");
  url.searchParams.set("v", "1");
  url.searchParams.set("e", validated.endpoint);
  url.searchParams.set("t", validated.pairingToken);
  url.searchParams.set("x", String(validated.expiresAt));
  url.searchParams.set("n", validated.displayName);
  url.searchParams.set("i", validated.emoji);
  url.searchParams.set("p", validated.tlsPinSha256);
  if (validated.identityExpiresAt !== undefined) url.searchParams.set("y", String(validated.identityExpiresAt));
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
  }, now);
}

function validatePairingPayload(value: unknown, now: number): CodeWidePairingPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid pairing payload");
  const payload = value as Partial<CodeWidePairingPayload> & { type?: unknown };
  if ((payload.type !== "codewide-pairing" && payload.type !== "codex-remote-pairing") || payload.version !== 1) {
    throw new Error("Unsupported pairing QR");
  }
  if (typeof payload.expiresAt !== "number" || !Number.isSafeInteger(payload.expiresAt)) throw new Error("Invalid pairing expiry");
  if (payload.expiresAt <= now) throw new Error("Pairing QR has expired");
  if (payload.expiresAt > now + 10 * 60_000) throw new Error("Pairing QR expiry is outside the allowed window");
  if (typeof payload.pairingToken !== "string" || payload.pairingToken.length < 32 || payload.pairingToken.length > 512) {
    throw new Error("Invalid pairing token");
  }
  if (typeof payload.displayName !== "string" || payload.displayName.trim().length < 1 || payload.displayName.trim().length > 80) {
    throw new Error("Invalid server name");
  }
  if (typeof payload.emoji !== "string" || payload.emoji.trim().length < 1 || payload.emoji.trim().length > 16) {
    throw new Error("Invalid server emoji");
  }
  if (typeof payload.endpoint !== "string") throw new Error("Invalid pairing endpoint");
  const endpoint = validateEndpoint(payload.endpoint);
  if (typeof payload.tlsPinSha256 !== "string" || !/^sha256\/[A-Za-z0-9+/]{43}=$/.test(payload.tlsPinSha256)) {
    throw new Error("Invalid TLS certificate pin");
  }
  if (payload.identityExpiresAt !== undefined && (
    typeof payload.identityExpiresAt !== "number"
    || !Number.isSafeInteger(payload.identityExpiresAt)
    || payload.identityExpiresAt <= now
  )) throw new Error("Invalid companion identity expiry");
  return {
    type: "codewide-pairing",
    version: 1,
    endpoint,
    pairingToken: payload.pairingToken,
    expiresAt: payload.expiresAt,
    displayName: payload.displayName.trim(),
    emoji: payload.emoji.trim(),
    tlsPinSha256: payload.tlsPinSha256,
    ...(payload.identityExpiresAt === undefined ? {} : { identityExpiresAt: payload.identityExpiresAt }),
  };
}

function validateEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid pairing endpoint");
  }
  if (url.protocol !== "wss:" && url.protocol !== "ws:") throw new Error("Pairing endpoint must use WebSocket");
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "10.0.2.2";
  if (url.protocol === "ws:" && !local) throw new Error("Remote pairing endpoint must use WSS");
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/v1/sync";
  if (url.pathname !== "/v1/sync" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("Invalid pairing endpoint shape");
  }
  return url.toString();
}
