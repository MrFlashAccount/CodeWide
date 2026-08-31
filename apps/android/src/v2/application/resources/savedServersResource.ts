import type { SavedServerRepository } from "../ports/savedServerRepository";
import type { SavedServer } from "../../domain/savedServer";
import { ObservableResource } from "./resource";

export class SavedServersResource extends ObservableResource<SavedServer[]> {
  readonly #repository: SavedServerRepository;
  #unsubscribe: (() => void) | null = null;

  constructor(repository: SavedServerRepository) {
    super([]);
    this.#repository = repository;
  }

  async start(): Promise<void> {
    this.#unsubscribe ??= this.#repository.subscribe(() => void this.refresh());
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.publish({ status: "ready", value: await this.#repository.list() });
    } catch {
      this.publish({
        message: "Could not load saved servers",
        status: "error",
        value: this.snapshot().value,
      });
    }
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}
