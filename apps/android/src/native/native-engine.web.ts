import type { NativeEngineSupervisorOptions } from "./native-engine-contract";
import type { RemoteConnection, RpcClient } from "@codewide/sync-client";

class WebNativeEngineSession implements RpcClient {
  readonly connectionId: string;
  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }
  async rpc<T>(_method: string, _params: unknown): Promise<T> {
    throw new Error("Native remote engine is available on Android only");
  }
  async respondToServerRequest(_id: string | number, _result: unknown): Promise<void> {
    throw new Error("Native remote engine is available on Android only");
  }
  stop(): void {}
}

export class NativeEngineSupervisor {
  constructor(_options: NativeEngineSupervisorOptions) {}
  replaceConnections(_connections: RemoteConnection[]): void {}
  session(_connectionId: string): WebNativeEngineSession | undefined {
    return undefined;
  }
  async reattachRuntime(_connectionId: string): Promise<void> {}
  stop(): void {}
}
