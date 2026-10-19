import type { NativeEngineSupervisorOptions } from "./native-engine-contract";
import type { RemoteConnection, RpcClient } from "@codewide/sync-client";

class WebNativeEngineSession implements RpcClient {
  readonly connectionId: string;
  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }
  async rpc<T>(_method: string, _params: unknown): Promise<T> {
    await Promise.resolve();
    throw new Error("Native remote engine is available on Android only");
  }
  async respondToServerRequest(_id: string | number, _result: unknown): Promise<void> {
    await Promise.resolve();
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
  async reattachRuntime(_connectionId: string): Promise<void> {
    await Promise.resolve();
  }

  async subscribeLive(_connectionId: string, _channelId: string, _threadId: string): Promise<void> {
    await Promise.resolve();
    throw new Error("Native live subscription is unavailable on web");
  }

  async unsubscribeLive(_connectionId: string, _channelId: string): Promise<void> {
    await Promise.resolve();
  }

  async interest(_connectionId: string, _threadIds: readonly string[]): Promise<void> {
    await Promise.resolve();
    throw new Error("Native thread interest is unavailable on web");
  }

  async listStreamVisible(_connectionId: string, _visible: boolean): Promise<void> {
    await Promise.resolve();
    throw new Error("Native thread-list stream is unavailable on web");
  }
  stop(): void {}
}
