import type { SavedServerRepository, SavedServerConnection } from "../ports/savedServerRepository";
import type { SavedServerId } from "../../domain/ids";
import { ObservableResource } from "./resource";

export class SavedServerConnectionResource extends ObservableResource<SavedServerConnection | null> {
  readonly #repository: SavedServerRepository;
  readonly #savedServerId: SavedServerId;

  constructor(repository: SavedServerRepository, savedServerId: SavedServerId) {
    super(null);
    this.#repository = repository;
    this.#savedServerId = savedServerId;
    this.refresh().catch(() => undefined);
  }

  async refresh(): Promise<void> {
    try {
      this.publish({
        status: "ready",
        value: await this.#repository.connection(this.#savedServerId),
      });
    } catch {
      this.publish({
        message: "Could not load saved server settings",
        status: "error",
        value: this.snapshot().value,
      });
    }
  }
}
