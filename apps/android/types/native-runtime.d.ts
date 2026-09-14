import "react-native";

// This file adds only globals supplied by the installed Hermes/React Native/Expo
// runtime and our boot code. It must never reference lib.dom or @types/node.
declare global {
  // React Native Libraries/Core/setUpPerformance.js and setUpTimers.js.
  var performance: { now(): number };
  function queueMicrotask(callback: () => void): void;

  // Hermes supplies the UTF-8 encoder; Expo winter/TextDecoder supplies decoding.
  class TextEncoder {
    readonly encoding: "utf-8";
    encode(input?: string): Uint8Array<ArrayBuffer>;
  }
  class TextDecoder {
    constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
    readonly encoding: string;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
    decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }): string;
  }

  // Expo winter/runtime.native.ts installs its DOMException class and the
  // @ungap/structured-clone implementation. Transfer lists are not supported.
  var DOMException: typeof import("expo/build/winter/DOMException").DOMException;
  function structuredClone<T>(value: T): T;

  // src/polyfills/secure-crypto.ts installs these two primitives at boot.
  var crypto: {
    getRandomValues<T extends Uint8Array>(array: T): T;
    randomUUID(): string;
  };

  // Use the native fetch constructor's input, not the DOM Headers declaration.
  type HeadersInit = NonNullable<ConstructorParameters<typeof Headers>[0]>;
}

export {};
