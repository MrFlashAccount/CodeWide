export function humanPairingError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Could not connect to this server";
  const normalized = message.toLocaleLowerCase();
  if (normalized.includes("expired")) return "This connection code has expired. Generate a new one on the host.";
  if (normalized.includes("clipboard")) return message;
  if (
    normalized.includes("network")
    || normalized.includes("timeout")
    || normalized.includes("failed to connect")
    || normalized.includes("connection failed")
    || normalized.includes("could not reach")
  ) return "Could not reach the host. The one-time code was not consumed; check the connection and retry.";
  if (normalized.includes("wss") || normalized.includes("endpoint")) return "This host address is not a valid secure CodeWide endpoint.";
  if (normalized.includes("token") || normalized.includes("pairing")) return "This connection code is invalid or has already been used.";
  return message;
}
