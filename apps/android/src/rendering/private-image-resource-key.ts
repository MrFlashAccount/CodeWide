import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { privateAssetCacheKey, type PrivateAssetSource } from "../data/private-transfer";

/** Resource identities must never retain inline image bytes or secret URLs. */
export function privateImageResourceKey(source: PrivateAssetSource): string {
  return bytesToHex(sha256(utf8ToBytes(privateAssetCacheKey(source))));
}
