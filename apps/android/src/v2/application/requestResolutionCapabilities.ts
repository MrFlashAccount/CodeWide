import type { V2PendingRequest, V2RequestResolution } from "@codewide/sync-client/v2";

import type { SavedServerId } from "../domain/ids";
import type { CommandActivationOwner } from "./commandActivationOwner";

type RequestResolutionCommandOwner = Pick<CommandActivationOwner, "execute">;

/** Resolves one authoritative pending request through durable V2 command admission. */
export class RequestResolutionCapabilities {
  readonly #commands: RequestResolutionCommandOwner;

  constructor(commands: RequestResolutionCommandOwner) {
    this.#commands = commands;
  }

  async resolve(
    savedServerId: SavedServerId,
    request: V2PendingRequest,
    resolution: V2RequestResolution,
  ): Promise<void> {
    const frame = await this.#commands.execute(savedServerId, {
      generation: request.generation,
      kind: "request.resolve",
      requestId: request.id,
      resolution,
    });
    if (frame.type !== "commandCompleted") throw new Error(frame.error.message);
    const { result } = frame;
    if (result.kind !== "request.resolve" || result.requestId !== request.id) {
      throw new Error("The server returned an unrelated request resolution");
    }
  }
}
