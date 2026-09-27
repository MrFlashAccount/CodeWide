import { isServerIconId, type ServerIconId } from "./serverIcons";

export type ConnectionInput = {
  displayName: string;
  endpoint: string;
  iconId: ServerIconId;
  relay?: { routeId: string; tlsPinSha256: string };
  tlsPinSha256?: string;
  token: string;
};

export type ConnectionUpdateInput = Omit<ConnectionInput, "token"> & { token?: string };

export function validateConnectionProfile(
  displayNameInput: string,
  iconIdInput: unknown,
): { displayName: string; iconId: ServerIconId } {
  const displayName = displayNameInput.trim();
  if (
    displayName.length < 1 ||
    displayName.length > 80 ||
    /[\u0000-\u001F\u007F]/u.test(displayName)
  ) {
    throw new Error("Server name must be 1–80 visible characters");
  }
  if (!isServerIconId(iconIdInput)) {
    throw new Error("Server icon is not supported");
  }
  return { displayName, iconId: iconIdInput };
}

export function validateConnectionInput(
  input: ConnectionInput,
): ConnectionInput & { tlsPinSha256: string } {
  const { displayName, iconId } = validateConnectionProfile(input.displayName, input.iconId);
  const endpoint = input.endpoint.trim();
  const token = input.token.trim();
  const tlsPinSha256 = input.tlsPinSha256?.trim();
  const relay = input.relay;
  if (token.length < 32 || token.length > 512) {
    throw new Error("Capability token is invalid");
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Endpoint must be a valid ws:// or wss:// URL");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Endpoint must use ws:// or wss://");
  }
  const localDevelopmentHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "10.0.2.2";
  const relayRoute = /^\/c\/[a-f0-9]{64}\/v1\/sync$/u.test(url.pathname);
  if (url.protocol === "ws:" && !localDevelopmentHost && !relayRoute) {
    throw new Error("Remote endpoints must use wss:// or an explicit inner-TLS relay route");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("Endpoint must not contain credentials, query parameters, or fragments");
  }
  const pathname = url.pathname === "/" || url.pathname === "" ? "/v1/sync" : url.pathname;
  if (pathname !== "/v1/sync" && !relayRoute) {
    throw new Error("Endpoint path must be /v1/sync or an explicit relay route");
  }
  if (tlsPinSha256 === undefined || !/^sha256\/[A-Za-z0-9+/]{43}=$/.test(tlsPinSha256)) {
    throw new Error("TLS pin must be an OkHttp sha256/base64 certificate pin");
  }
  if (
    relay !== undefined &&
    (!/^[a-f0-9]{64}$/u.test(relay.routeId) ||
      !/^sha256\/[A-Za-z0-9+/]{43}=$/u.test(relay.tlsPinSha256) ||
      url.protocol !== "wss:" ||
      pathname !== "/v1/sync")
  ) {
    throw new Error("Pinned Relay requires a valid route, certificate pin and WSS endpoint");
  }
  return {
    displayName,
    endpoint: (pathname === url.pathname ? url : new URL(pathname, url)).toString(),
    iconId,
    tlsPinSha256,
    token,
    ...(relay === undefined ? {} : { relay }),
  };
}

export function validateConnectionUpdateInput(
  input: ConnectionUpdateInput,
  currentToken: string,
): ConnectionInput {
  const replacement = input.token?.trim();
  return validateConnectionInput({
    ...input,
    token: replacement === undefined || replacement === "" ? currentToken : replacement,
  });
}

export function validateConnectionRuntimeUpdate(
  input: ConnectionUpdateInput,
): ConnectionUpdateInput {
  const replacement = input.token?.trim();
  const validated = validateConnectionInput({
    ...input,
    token: replacement === undefined || replacement === "" ? "x".repeat(32) : replacement,
  });
  return {
    displayName: validated.displayName,
    endpoint: validated.endpoint,
    iconId: validated.iconId,
    ...(replacement === undefined || replacement === "" ? {} : { token: validated.token }),
    tlsPinSha256: validated.tlsPinSha256,
  };
}

export function isProfileOnlyConnectionUpdate(
  input: ConnectionUpdateInput,
  current: Pick<ConnectionInput, "endpoint" | "tlsPinSha256">,
): boolean {
  const replacementToken = input.token?.trim();
  const trimmedPin = input.tlsPinSha256?.trim();
  const nextPin = trimmedPin === undefined || trimmedPin === "" ? undefined : trimmedPin;
  return (
    (replacementToken === undefined || replacementToken === "") &&
    input.endpoint.trim() === current.endpoint &&
    nextPin === current.tlsPinSha256
  );
}
