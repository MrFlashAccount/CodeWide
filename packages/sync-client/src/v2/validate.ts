import { V2GeneratedContractError, validateV2ContractDefinition } from "./contract.generated";
import type { V2ServerFrame } from "./frames";
import { V2ProtocolValidationError } from "./validate-shared";

export { V2ProtocolValidationError } from "./validate-shared";

/** Parse with the generated JSON Schema runtime before any projection mutation. */
export function parseV2ServerFrame(raw: string): V2ServerFrame {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new V2ProtocolValidationError("Malformed Sync V2 JSON");
  }
  try {
    validateV2ContractDefinition("serverFrame", value);
  } catch (cause: unknown) {
    if (cause instanceof V2GeneratedContractError) throw new V2ProtocolValidationError("Invalid closed Sync V2 server frame");
    throw cause;
  }
  return value as V2ServerFrame;
}
