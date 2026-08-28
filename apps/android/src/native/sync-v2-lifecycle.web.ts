import type { NativeConnectionConfig } from "./native-transport.web";

export type NativeSyncV2Lifecycle = {
  reconcile(configs: readonly NativeConnectionConfig[]): Promise<void>;
  deleteSavedServer(savedServerId: string): Promise<void>;
  stop(): void;
};

export function createNativeSyncV2Lifecycle(): NativeSyncV2Lifecycle {
  return {
    async reconcile() {},
    async deleteSavedServer() {},
    stop() {},
  };
}
