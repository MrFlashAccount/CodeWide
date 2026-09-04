import type { RemoteConnection, RpcClient, SyncCache, SyncEvent } from "@codewide/sync-client";

class WebNativeEngineSession implements RpcClient {
  readonly connectionId: string;
  constructor(connectionId: string) { this.connectionId = connectionId; }
  async rpc<T>(): Promise<T> { throw new Error("Native remote engine is available on Android only"); }
  async respondToServerRequest(): Promise<void> { throw new Error("Native remote engine is available on Android only"); }
  stop(): void {}
}

export class NativeEngineSupervisor {
  constructor(_options: { cache: SyncCache; projection: Pick<SyncCache, "applySnapshot" | "applyEvents">; onCommittedEvents?(connectionId: string, events: SyncEvent[]): Promise<void>; onOutboxChange?(delivery: import("./native-transport.web").NativeCommandDelivery): void }) {}
  replaceConnections(_connections: RemoteConnection[]): void {}
  session(_connectionId: string): WebNativeEngineSession | undefined { return undefined; }
  async reattachRuntime(_connectionId: string): Promise<void> {}
  stop(): void {}
}
