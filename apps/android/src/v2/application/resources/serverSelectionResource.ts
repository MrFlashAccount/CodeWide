import type { ServerSelection } from "../../domain/serverSelection";
import { ObservableResource } from "./resource";

export class ServerSelectionResource extends ObservableResource<ServerSelection> {
  constructor() {
    super({ kind: "all" });
    this.publish({ status: "ready", value: { kind: "all" } });
  }

  select(value: ServerSelection): void {
    this.publish({ status: "ready", value });
  }
}
