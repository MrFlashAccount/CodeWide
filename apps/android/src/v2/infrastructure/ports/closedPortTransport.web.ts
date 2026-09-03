import type { PortTransport } from "../../application/ports/portTransport";

const unavailable = (): Promise<never> =>
  Promise.reject(new Error("Ports are available on Android only"));

export function createClosedPortTransport(): PortTransport {
  return {
    createTunnel: unavailable,
    createProfileId: () => "unavailable",
    deleteTunnel: unavailable,
    discover: unavailable,
    list: unavailable,
    remove: unavailable,
    start: unavailable,
    stop: unavailable,
    subscribe: () => () => undefined,
    upsert: unavailable,
  };
}
