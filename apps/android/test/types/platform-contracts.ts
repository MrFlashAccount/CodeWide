// Compile-only compatibility: browser bridge functions must keep the callable
// native public contract, even when the browser implementation rejects a call.
import type * as NativeTransport from "../../src/native/native-transport.native";
import type * as WebTransport from "../../src/native/native-transport.web";
import type * as NativeEngine from "../../src/native/native-engine.native";
import type * as WebEngine from "../../src/native/native-engine.web";

export function checkTransportContract(web: typeof WebTransport): Pick<typeof NativeTransport, keyof typeof WebTransport> {
  return web;
}

export function checkEngineOptions(options: ConstructorParameters<typeof WebEngine.NativeEngineSupervisor>[0]): ConstructorParameters<typeof NativeEngine.NativeEngineSupervisor>[0] {
  return options;
}
