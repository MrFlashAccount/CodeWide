import type { PortTransport } from "../../application/ports/portTransport";

const unavailable = (): Promise<never> =>
  Promise.reject(new Error("Ports are available on Android only"));

export function createClosedPortTransport(): PortTransport {
  return { createTunnel: unavailable, deleteTunnel: unavailable, list: unavailable };
}
