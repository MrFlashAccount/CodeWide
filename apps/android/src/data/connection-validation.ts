export type ConnectionInput = {
  displayName: string;
  emoji: string;
  endpoint: string;
  token: string;
  tlsPinSha256?: string;
};

export type ConnectionUpdateInput = Omit<ConnectionInput, "token"> & { token?: string };

export function validateConnectionProfile(displayNameInput: string, emojiInput: string): { displayName: string; emoji: string } {
  const displayName = displayNameInput.trim();
  const emoji = emojiInput.trim();
  if (displayName.length < 1 || displayName.length > 80 || /[\u0000-\u001f\u007f]/u.test(displayName)) {
    throw new Error("Server name must be 1–80 visible characters");
  }
  if (emoji.length < 1 || emoji.length > 32 || !isSingleEmojiGrapheme(emoji)) {
    throw new Error("Server icon must be one emoji");
  }
  return { displayName, emoji };
}

export function validateConnectionInput(input: ConnectionInput): ConnectionInput {
  const { displayName, emoji } = validateConnectionProfile(input.displayName, input.emoji);
  const endpoint = input.endpoint.trim();
  const token = input.token.trim();
  const tlsPinSha256 = input.tlsPinSha256?.trim();
  if (token.length < 32 || token.length > 512) throw new Error("Capability token is invalid");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Endpoint must be a valid ws:// or wss:// URL");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("Endpoint must use ws:// or wss://");
  const localDevelopmentHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "10.0.2.2";
  if (url.protocol === "ws:" && !localDevelopmentHost) {
    throw new Error("Remote endpoints must use wss://; cleartext ws:// is limited to local development");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("Endpoint must not contain credentials, query parameters, or fragments");
  }
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/v1/sync";
  if (url.pathname !== "/v1/sync") throw new Error("Endpoint path must be /v1/sync");
  if (tlsPinSha256 !== undefined && !/^sha256\/[A-Za-z0-9+/]{43}=$/.test(tlsPinSha256)) {
    throw new Error("TLS pin must be an OkHttp sha256/base64 certificate pin");
  }
  if (tlsPinSha256 !== undefined && url.protocol !== "wss:") throw new Error("TLS pin requires WSS");
  return { displayName, emoji, endpoint: url.toString(), token, ...(tlsPinSha256 === undefined ? {} : { tlsPinSha256 }) };
}

export function validateConnectionUpdateInput(input: ConnectionUpdateInput, currentToken: string): ConnectionInput {
  const replacement = input.token?.trim();
  return validateConnectionInput({
    ...input,
    token: replacement === undefined || replacement === "" ? currentToken : replacement,
  });
}

export function validateConnectionRuntimeUpdate(input: ConnectionUpdateInput): ConnectionUpdateInput {
  const replacement = input.token?.trim();
  const validated = validateConnectionInput({
    ...input,
    token: replacement === undefined || replacement === "" ? "x".repeat(32) : replacement,
  });
  return {
    displayName: validated.displayName,
    emoji: validated.emoji,
    endpoint: validated.endpoint,
    ...(replacement === undefined || replacement === "" ? {} : { token: validated.token }),
    ...(validated.tlsPinSha256 === undefined ? {} : { tlsPinSha256: validated.tlsPinSha256 }),
  };
}

export function isProfileOnlyConnectionUpdate(
  input: ConnectionUpdateInput,
  current: Pick<ConnectionInput, "endpoint" | "tlsPinSha256">,
): boolean {
  const replacementToken = input.token?.trim();
  const nextPin = input.tlsPinSha256?.trim() || undefined;
  return (replacementToken === undefined || replacementToken === "")
    && input.endpoint.trim() === current.endpoint
    && nextPin === current.tlsPinSha256;
}

function isSingleEmojiGrapheme(value: string): boolean {
  const singleEmojiSequence = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)$/u;
  if (!singleEmojiSequence.test(value)) return false;
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => {
      segment(input: string): Iterable<unknown>;
    };
  }).Segmenter;
  return Segmenter === undefined
    || [...new Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length === 1;
}
