import type { VoiceTransport } from "./ports/voiceTransport";
import type { SavedServerId } from "../domain/ids";

export class VoiceInputController {
  readonly transport: VoiceTransport;
  readonly #active = new Map<SavedServerId, Set<Awaited<ReturnType<VoiceTransport["start"]>>>>();
  constructor(transport: VoiceTransport) {
    this.transport = transport;
  }
  async start(input: Parameters<VoiceTransport["start"]>[0]): ReturnType<VoiceTransport["start"]> {
    const active = this.#activeFor(input.audience);
    let handle: Awaited<ReturnType<VoiceTransport["start"]>> | null = null;
    const remove = (): void => {
      if (handle === null) return;
      active.delete(handle);
      if (active.size === 0) this.#active.delete(input.audience);
    };
    handle = await this.transport.start({
      ...input,
      onEvent: (event) => {
        input.onEvent(event);
        if (event.type === "result" || event.type === "cancelled" || event.type === "error")
          remove();
      },
    });
    active.add(handle);
    return handle;
  }

  /** Stops every active Voice transport for one saved server before deletion. */
  async cancelSavedServer(savedServerId: SavedServerId): Promise<void> {
    const active = this.#active.get(savedServerId);
    if (active === undefined) return;
    await Promise.all([...active].map((handle) => handle.cancel().catch(() => undefined)));
    this.#active.delete(savedServerId);
  }

  #activeFor(savedServerId: SavedServerId): Set<Awaited<ReturnType<VoiceTransport["start"]>>> {
    let active = this.#active.get(savedServerId);
    if (active === undefined) {
      active = new Set();
      this.#active.set(savedServerId, active);
    }
    return active;
  }
}
