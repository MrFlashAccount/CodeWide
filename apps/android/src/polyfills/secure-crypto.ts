import { getRandomValues, randomUUID } from "expo-crypto";

type SecureCryptoGlobal = {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
  randomUUID?: () => string;
};

// WHY: This startup polyfill must augment the host crypto object in place, while React Native's library type omits randomUUID and declares a different getRandomValues signature; no compatible shared type exists.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const secureCrypto = readHostCrypto() as SecureCryptoGlobal;

function readHostCrypto(): unknown {
  // WHY: Hermes may omit the DOM-declared crypto global before this startup polyfill installs it.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  return globalThis.crypto ?? {};
}

if (typeof secureCrypto.getRandomValues !== "function") {
  secureCrypto.getRandomValues = (array) => getRandomValues(array);
}
if (typeof secureCrypto.randomUUID !== "function") {
  secureCrypto.randomUUID = randomUUID;
}
// WHY: Hermes may omit the DOM-declared crypto global before this startup polyfill installs it.
// oxlint-disable-next-line typescript/no-unnecessary-condition
if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: secureCrypto,
    writable: true,
  });
}

export function assertSecureCryptoRuntime(): void {
  if (
    typeof secureCrypto.getRandomValues !== "function" ||
    typeof secureCrypto.randomUUID !== "function"
  ) {
    throw new Error("secure crypto primitives are unavailable");
  }
  const probe = secureCrypto.getRandomValues(new Uint8Array(16));
  if (probe.length !== 16 || probe.every((value) => value === 0)) {
    throw new Error("secure random generator failed its startup probe");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      secureCrypto.randomUUID(),
    )
  ) {
    throw new Error("secure UUID generator failed its startup probe");
  }
}
