import { getRandomValues, randomUUID } from "expo-crypto";

type SecureCryptoGlobal = {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
  randomUUID?: () => string;
};

const secureCrypto = (globalThis.crypto ?? {}) as SecureCryptoGlobal;

if (typeof secureCrypto.getRandomValues !== "function") {
  secureCrypto.getRandomValues = (array) => getRandomValues(array);
}
if (typeof secureCrypto.randomUUID !== "function") {
  secureCrypto.randomUUID = randomUUID;
}
if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: secureCrypto,
    writable: true,
  });
}

export function assertSecureCryptoRuntime(): void {
  const runtimeCrypto = globalThis.crypto as SecureCryptoGlobal | undefined;
  if (typeof runtimeCrypto?.getRandomValues !== "function" || typeof runtimeCrypto.randomUUID !== "function") {
    throw new Error("secure crypto primitives are unavailable");
  }
  const probe = runtimeCrypto.getRandomValues(new Uint8Array(16));
  if (probe.length !== 16 || probe.every((value) => value === 0)) {
    throw new Error("secure random generator failed its startup probe");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runtimeCrypto.randomUUID())) {
    throw new Error("secure UUID generator failed its startup probe");
  }
}
