import type { V2PortsResponse, V2TunnelCreateResponse } from "@codewide/sync-client/v2";

import type { PortTransport } from "../ports/portTransport";
import type { SavedServerId } from "../../domain/ids";
import { ObservableResource } from "./resource";

const EMPTY: V2PortsResponse = { ports: [], scannedAt: 0 };

export class PortsResource extends ObservableResource<V2PortsResponse> {
  readonly #transport: PortTransport;
  readonly #savedServerId: SavedServerId;

  constructor(transport: PortTransport, savedServerId: SavedServerId) {
    super(EMPTY);
    this.#transport = transport;
    this.#savedServerId = savedServerId;
    this.refresh().catch(() => undefined);
  }

  async createTunnel(port: number): Promise<V2TunnelCreateResponse> {
    return this.#transport.createTunnel(this.#savedServerId, port);
  }

  async deleteTunnel(tunnelId: string): Promise<void> {
    await this.#transport.deleteTunnel(this.#savedServerId, tunnelId);
  }

  async refresh(): Promise<void> {
    try {
      this.publish({ status: "ready", value: await this.#transport.list(this.#savedServerId) });
    } catch {
      this.publish({
        message: "Could not discover server ports",
        status: "error",
        value: this.snapshot().value,
      });
    }
  }
}
